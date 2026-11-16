// Ergebnisse von World Athletics – so wenige Abfragen wie möglich:
//
// MODUS=neu   (stündlich 8–23 Uhr): ein Sammelabruf liefert die Ergebnisse der letzten ~30 Tage für alle
//             Athleten (Blöcke zu 100, ohne WA-Punkte). Nur Athleten mit einem bisher unbekannten Ergebnis
//             (neu, nachgereichte Disziplin, geänderte Zeit) werden einzeln mit WA-Punkten neu geladen.
// MODUS=nacht (3 Uhr): Athleten ohne vollständigen Abruf (neu im Pool) für aktuelles Jahr und Vorjahr,
//             außerdem alle Kader-Athleten und ein Siebtel der übrigen komplett (fängt Korrekturen ab).
// MODUS=voll  (von Hand): alle Athleten für RESULT_YEARS komplett.
//
// Danach: geteilte Finals und Vorrunden auflösen, Wettkämpfe speichern, Punkte (rebuild_results),
// Saisonwertungen und fällige Stichtage (run_maintenance).
//
// Umgebung: SUPABASE_URL, SUPABASE_SERVICE_KEY, MODUS, optional WA_API_URL/WA_API_KEY,
//           RESULT_YEARS (nur MODUS=voll, z. B. "2026,2025"), WA_CONCURRENCY
import { adminClient, chunked, currentYear, rpc, run, selectAll } from "./supabase";
import { combinedPlace, fetchEventRaces, isPrelimRace, isSplitFinal, prelimPlacing, PRELIM_CATEGORIES, type Race } from "./placings";
import { ApiAuthError, RateLimitError, discoverApiConfig, fetchAthleteResults, fetchRecentResults, FEED_LIMIT, sleep, type ApiConfig, type FeedResult } from "./wa";

const CONCURRENCY = Number(process.env.WA_CONCURRENCY ?? 2);
const MODE = (process.env.MODUS || "neu") as "neu" | "nacht" | "voll";
const FEED_BLOCK = 100;
const db = adminClient();
type Row = Record<string, unknown>;
type Athlete = { slug: string; id: number; name: string };
type Job = { slug: string; id: number; year: number };

/** Schlüssel eines Ergebnisses im Sammelabruf – ändert sich etwas daran, wird der Athlet neu geladen. */
export const feedKey = (r: FeedResult) => [r.date, r.competition, r.discipline, r.race, r.mark, r.place].join("|");

await run(db, async () => {
  const started = new Date().toISOString();
  const Y = currentYear();

  // Athleten: Pool + alle, die gerade in einem Kader stehen
  const pool = await selectAll<{ id: string; wa_id: number | null; name: string }>((a, b) =>
    db.from("athletes").select("id, wa_id, name").not("pool_rank", "is", null).order("id").range(a, b));
  const rostered = await selectAll<{ athlete_id: string }>((a, b) =>
    db.from("roster_entries").select("athlete_id").is("released_on", null).order("id").range(a, b));
  const extra = [...new Set(rostered.map((r) => r.athlete_id))].filter((s) => !pool.some((p) => p.id === s));
  const more = extra.length ? (await db.from("athletes").select("id, wa_id, name").in("id", extra)).data ?? [] : [];
  const athletes: Athlete[] = [...pool, ...more].filter((a) => a.wa_id || /^wa-\d+$/.test(a.id))
    .map((a) => ({ slug: a.id, id: Number(a.wa_id ?? a.id.slice(3)), name: a.name }));
  if (!athletes.length) return "Keine Athleten im Pool – zuerst den Athletenpool laden";
  const names = new Map(athletes.map((a) => [a.slug, a.name]));

  let api: ApiConfig = process.env.WA_API_URL && process.env.WA_API_KEY
    ? { url: process.env.WA_API_URL, key: process.env.WA_API_KEY }
    : await discoverApiConfig();
  let rediscovered = false;
  /** Bei abgelehntem API-Key einmal neu von der Website lesen und wiederholen. */
  async function withApi<T>(fn: (api: ApiConfig) => Promise<T>): Promise<T> {
    try {
      return await fn(api);
    } catch (e) {
      if (!(e instanceof ApiAuthError) || rediscovered) throw e;
      rediscovered = true;
      console.warn("API-Key abgelehnt, lese neue Konfiguration von worldathletics.org");
      api = await discoverApiConfig();
      return fn(api);
    }
  }

  // ---- Was muss geladen werden? -------------------------------------------------------------
  const jobs: Job[] = [];
  const add = (a: Athlete, year: number) => {
    if (!jobs.some((j) => j.slug === a.slug && j.year === year)) jobs.push({ slug: a.slug, id: a.id, year });
  };
  const feedUpdates: { athlete_id: string; keys: string[]; changed_at: string }[] = [];
  let summary = "";

  if (MODE === "voll") {
    const years = (process.env.RESULT_YEARS || String(Y)).split(",").map((y) => Number(y.trim())).filter(Boolean);
    for (const a of athletes) for (const y of years) add(a, y);
    summary = `voll (${years.join(", ")})`;
  } else if (MODE === "nacht") {
    const synced = await selectAll<{ athlete_id: string; year: number; checked_at: string }>((a, b) =>
      db.from("athlete_sync").select("athlete_id, year, checked_at").in("year", [Y, Y - 1]).order("athlete_id").range(a, b));
    const at = new Map(synced.map((s) => [`${s.athlete_id}|${s.year}`, s.checked_at]));
    // neu im Pool: aktuelles Jahr und Vorjahr einmal komplett
    const fresh = athletes.filter((a) => !at.has(`${a.slug}|${Y}`) || !at.has(`${a.slug}|${Y - 1}`));
    for (const a of fresh) {
      if (!at.has(`${a.slug}|${Y}`)) add(a, Y);
      if (!at.has(`${a.slug}|${Y - 1}`)) add(a, Y - 1);
    }
    // Kader-Athleten jede Nacht (ihre Punkte zählen), dazu ein Siebtel der übrigen, am längsten nicht
    // geprüften Athleten (= jeder einmal pro Woche); im Januar auch das Vorjahr
    const january = new Date().getMonth() === 0;
    const inRoster = new Set(rostered.map((r) => r.athlete_id));
    const squad = athletes.filter((a) => inRoster.has(a.slug) && at.has(`${a.slug}|${Y}`));
    const rest = athletes.filter((a) => !inRoster.has(a.slug) && at.has(`${a.slug}|${Y}`));
    const oldest = rest.sort((a, b) => String(at.get(`${a.slug}|${Y}`)).localeCompare(String(at.get(`${b.slug}|${Y}`))))
      .slice(0, Math.ceil(rest.length / 7));
    for (const a of [...squad, ...oldest]) { add(a, Y); if (january) add(a, Y - 1); }
    summary = `nacht: ${fresh.length} neue Athleten, ${squad.length} aus Kadern, ${oldest.length} weitere zur Kontrolle`;
  } else {
    // Sammelabruf
    const feed: FeedResult[] = [];
    for (let i = 0; i < athletes.length; i += FEED_BLOCK) {
      const block = athletes.slice(i, i + FEED_BLOCK).map((a) => a.id);
      const rows = await withApi((api) => fetchRecentResults(api, block));
      if (rows.length >= FEED_LIMIT) console.warn(`Sammelabruf: Grenze von ${FEED_LIMIT} erreicht – Blöcke verkleinern`);
      feed.push(...rows);
      await sleep(500 + Math.random() * 500);
    }
    const known = new Map((await selectAll<{ athlete_id: string; keys: string[] }>((a, b) =>
      db.from("athlete_feed").select("athlete_id, keys").order("athlete_id").range(a, b))).map((r) => [r.athlete_id, new Set(r.keys)]));
    const byId = new Map(athletes.map((a) => [a.id, a]));
    const grouped = new Map<string, FeedResult[]>();
    for (const r of feed) {
      const a = byId.get(r.athleteId);
      if (a) grouped.set(a.slug, [...(grouped.get(a.slug) ?? []), r]);
    }
    for (const [slug, rows] of grouped) {
      const keys = [...new Set(rows.map(feedKey))].sort();
      const seen = known.get(slug);
      if (seen && keys.every((k) => seen.has(k))) continue;          // nichts Neues
      const a = athletes.find((x) => x.slug === slug)!;
      for (const y of new Set(rows.map((r) => Number(r.date?.slice(0, 4) || Y)))) add(a, y);
      feedUpdates.push({ athlete_id: slug, keys, changed_at: started });
    }
    summary = `Sammelabruf: ${feed.length} Ergebnisse der letzten Wochen, ${feedUpdates.length} Athleten mit Neuem`;
  }

  if (!jobs.length) {
    await rpc(db, "run_maintenance");
    return `${summary} – nichts zu laden`;
  }

  // ---- Einzelabruf mit WA-Punkten -----------------------------------------------------------
  const queue = [...jobs];
  const rows: Row[] = [];
  const loaded: Job[] = [];
  const failures: string[] = [];
  let throttled = false;
  async function worker() {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        const results = await withApi((api) => fetchAthleteResults(api, job!.id, job!.year));
        for (const r of results) {
          rows.push({
            athlete_id: job.slug, date: r.date, competition: r.competition, venue: r.venue,
            discipline: r.discipline, country: r.country, category: r.category,
            race: r.race, place: r.place, wa_race: r.race, wa_place: r.place,
            placing_round: null, placing_place: null,
            mark: r.mark, result_score: r.resultScore, remark: r.remark,
            wa_competition_id: r.competitionId, wa_event_id: r.eventId, imported_at: new Date().toISOString(), source: "wa",
          });
        }
        loaded.push(job);
      } catch (e) {
        if (e instanceof ApiAuthError) throw e;
        if (e instanceof RateLimitError) {
          // WA bremst: sofort aufhören, Geladenes speichern, Rest beim nächsten Lauf
          throttled = true;
          queue.length = 0;
          break;
        }
        failures.push(`${job.slug}/${job.year}: ${(e as Error).message}`);
      }
      await sleep(300 + Math.random() * 500);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length > Math.max(5, jobs.length / 4)) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 50).join("\n")}`);
  const years = [...new Set(loaded.map((j) => j.year))];

  // Doppelte Schlüssel innerhalb eines Batches würden den Upsert abbrechen.
  const key = (r: Row) => [r.athlete_id, r.date, r.discipline, r.wa_race, r.competition].join("|");
  const unique = [...new Map(rows.map((r) => [key(r), r])).values()];

  const placings = years.length ? await resolveEventPlacings(unique, api, years, names) : "";

  await chunked(unique, 500, async (chunk) => {
    const { error } = await db.from("wa_results").upsert(chunk, { onConflict: "athlete_id,date,discipline,wa_race,competition" });
    if (error) throw new Error(`wa_results: ${error.message}`);
  });
  // Ergebnisse, die WA nicht mehr führt (Korrekturen), für die erfolgreich geladenen Athleten entfernen
  for (const year of years) {
    const slugs = loaded.filter((l) => l.year === year).map((l) => l.slug);
    await chunked(slugs, 100, async (chunk) => {
      const { error } = await db.from("wa_results").delete().in("athlete_id", chunk).eq("source", "wa")
        .gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).lt("imported_at", started);
      if (error) throw new Error(`wa_results löschen: ${error.message}`);
    });
  }
  // Stand merken: vollständig geladene Athleten/Jahre und (bei Erfolg) den Sammelabruf
  await chunked(loaded.map((l) => ({ athlete_id: l.slug, year: l.year, checked_at: started })), 500, async (chunk) => {
    const { error } = await db.from("athlete_sync").upsert(chunk, { onConflict: "athlete_id,year" });
    if (error) throw new Error(`athlete_sync: ${error.message}`);
  });
  const ok = new Set(loaded.map((l) => l.slug));
  const failed = new Set(jobs.filter((j) => !loaded.includes(j)).map((j) => j.slug));
  await chunked(feedUpdates.filter((f) => ok.has(f.athlete_id) && !failed.has(f.athlete_id)), 500, async (chunk) => {
    const { error } = await db.from("athlete_feed").upsert(chunk, { onConflict: "athlete_id" });
    if (error) throw new Error(`athlete_feed: ${error.message}`);
  });

  // Wettkämpfe
  const competitions = new Map<string, Row>();
  for (const r of unique) {
    if (!r.wa_competition_id) continue;
    const slug = `wa-c${r.wa_competition_id}`;
    const prev = competitions.get(slug);
    const d = String(r.date);
    competitions.set(slug, {
      // Cross: Distanzangabe ("- XC 7.5km") gehört zum Rennen, nicht zum Wettkampf
      id: slug, name: String(r.competition).replace(/\s*-\s*XC\s*[\d.,]+\s*km$/i, ""), venue: r.venue, country: r.country, category: r.category,
      start_date: prev && String(prev.start_date) < d ? prev.start_date : d,
      end_date: prev && String(prev.end_date) > d ? prev.end_date : d,
      loaded_at: started,
    });
  }
  await chunked([...competitions.values()], 500, async (chunk) => {
    const { error } = await db.from("competitions").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`competitions: ${error.message}`);
  });

  // Punkte, Saisonwertung, Stichtage
  const scored = years.length ? await rpc<number>(db, "rebuild_results", { p_from: `${Math.min(...years)}-01-01` }) : 0;
  for (const y of new Set([...years, Y])) await rpc(db, "refresh_season_stats", { p_year: y });
  // nachts: WA-Punkteformel für Nachträge aus den aktuellen Daten neu berechnen
  if (MODE !== "neu") console.log(`WA-Punktetabellen: ${await rpc<number>(db, "fit_scoring_coefficients", {})}`);
  await rpc(db, "run_maintenance");
  if (failures.length || throttled) {
    await db.from("sync_status").update({ ok: false,
      message: throttled ? "World Athletics bremst – Rest folgt beim nächsten Abruf" : `${failures.length} Athleten nicht geladen` }).eq("id", 1);
  }

  return `${summary}; geladen: ${loaded.length} Athleten/Jahre, ${unique.length} Ergebnisse, ${scored} mit Punkten; ${placings}` +
    (throttled ? `\nWA bremst (429) – Lauf vorzeitig beendet, ${jobs.length - loaded.length} offen` : "") +
    (failures.length ? `\n${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
});

/**
 * Platzierungen aus den Detailergebnissen des Events:
 * - Finals mit mehreren Läufen (F1, F2, ...) -> kombinierte Platzierung, gewertet als Lauf "F"
 * - letzte Runde vor dem Finale bei OW/DF/GW/GL -> placing_round P9/P10, placing_place (0 = Q/q)
 * Bereits aufgelöste Ergebnisse werden aus der DB übernommen, jedes Event nur einmal geladen.
 */
async function resolveEventPlacings(rows: Row[], api: ApiConfig, years: number[], names: Map<string, string>) {
  const split = rows.filter((r) => isSplitFinal(String(r.wa_race)));
  const prelims = rows.filter((r) => isPrelimRace(String(r.wa_race)) && PRELIM_CATEGORIES.includes(String(r.category)));
  if (!split.length && !prelims.length) return "keine Detailergebnisse nötig";

  const key = (r: Row) => [r.athlete_id, r.date, r.discipline, r.wa_race, r.competition].join("|");
  type Known = { athlete_id: string; date: string; discipline: string; wa_race: string; competition: string;
                 race: string; place: number | null; placing_round: string | null; placing_place: number | null };
  const known = new Map<string, Known>();
  const prev = await selectAll<Known>((a, b) => db.from("wa_results")
    .select("athlete_id, date, discipline, wa_race, competition, race, place, placing_round, placing_place")
    .or("race.eq.F,placing_round.not.is.null").neq("wa_race", "F").neq("wa_race", "")
    .gte("date", `${Math.min(...years)}-01-01`).lte("date", `${Math.max(...years)}-12-31`)
    .order("id").range(a, b));
  for (const r of prev) known.set(key(r), r);
  const who = (r: Row) => ({ id: Number(String(r.athlete_id).slice(3)), name: names.get(String(r.athlete_id)) });

  const events = new Map<string, Promise<Race[]>>();
  const racesFor = (r: Row) => {
    const ek = `${r.wa_competition_id}:${r.wa_event_id}`;
    if (!events.has(ek)) {
      events.set(ek, sleep(300).then(() => fetchEventRaces(api, Number(r.wa_competition_id), Number(r.wa_event_id))).catch((e) => {
        console.warn(`Detailergebnisse ${ek}: ${(e as Error).message}`);
        return [];
      }));
    }
    return events.get(ek)!;
  };

  const stats = { finals: 0, finalsOpen: 0, prelims: 0, prelimsOpen: 0 };
  for (const r of split) {
    const prev = known.get(key(r));
    let place = prev?.race === "F" ? prev.place : null;
    if (place === null && r.wa_competition_id && r.wa_event_id) {
      place = combinedPlace(await racesFor(r), r.mark as string | null, who(r));
    }
    if (place !== null) {
      r.race = "F";
      r.place = place;
      stats.finals++;
    } else {
      // Ohne kombinierte Platzierung bleibt es beim Lauf F1/F2 -> keine Platzierungspunkte.
      stats.finalsOpen++;
      console.warn(`Keine kombinierte Platzierung für ${key(r)}`);
    }
  }
  for (const r of prelims) {
    const prev = known.get(key(r));
    let placing = prev?.placing_round ? { round: prev.placing_round, place: prev.placing_place } : null;
    if (!placing && r.wa_competition_id && r.wa_event_id) {
      placing = prelimPlacing(await racesFor(r), who(r));
    }
    if (placing) {
      r.placing_round = placing.round;
      r.placing_place = placing.place;
      stats.prelims++;
    } else {
      // z. B. Vorlauf vor einem Halbfinale: keine Platzierungspunkte (aber erneuter Versuch beim nächsten Import)
      stats.prelimsOpen++;
    }
  }
  return `geteilte Finals: ${stats.finals} kombiniert, ${stats.finalsOpen} offen; ` +
    `Vorrunden: ${stats.prelims} gewertet, ${stats.prelimsOpen} ohne Wertung`;
}
