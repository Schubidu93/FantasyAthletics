// Ergebnisse: lädt die Ergebnisse aller Pool-Athleten (und aller Athleten in Kadern) von der
// WA-GraphQL-API, löst geteilte Finals und Vorrunden auf, speichert sie in wa_results/races und
// berechnet danach die Punkte (rebuild_results), Saisonwertungen und fällige Stichtage (run_maintenance).
//
// Umgebung: SUPABASE_URL, SUPABASE_SERVICE_KEY, optional WA_API_URL/WA_API_KEY,
//           RESULT_YEARS (z. B. "2026,2025"; Standard: aktuelles Jahr), WA_CONCURRENCY
import { adminClient, chunked, currentYear, rpc, run, selectAll } from "./supabase";
import { combinedPlace, fetchEventRaces, isPrelimRace, isSplitFinal, prelimPlacing, PRELIM_CATEGORIES, type Race } from "./placings";
import { ApiAuthError, discoverApiConfig, fetchAthleteResults, sleep, type ApiConfig } from "./wa";

const CONCURRENCY = Number(process.env.WA_CONCURRENCY ?? 3);
const db = adminClient();
type Row = Record<string, unknown>;

await run(db, async () => {
  const started = new Date().toISOString();
  const years = (process.env.RESULT_YEARS || String(currentYear())).split(",").map((y) => Number(y.trim())).filter(Boolean);

  // Athleten: Pool + alle, die gerade in einem Kader stehen
  const pool = await selectAll<{ pcs_slug: string; wa_id: number | null; name: string }>((a, b) =>
    db.from("riders").select("pcs_slug, wa_id, name").not("uci_rank", "is", null).order("pcs_slug").range(a, b));
  const rostered = await selectAll<{ rider_slug: string }>((a, b) =>
    db.from("roster_entries").select("rider_slug").is("released_on", null).order("id").range(a, b));
  const extra = [...new Set(rostered.map((r) => r.rider_slug))].filter((s) => !pool.some((p) => p.pcs_slug === s));
  const more = extra.length ? (await db.from("riders").select("pcs_slug, wa_id, name").in("pcs_slug", extra)).data ?? [] : [];
  const athletes = [...pool, ...more].filter((a) => a.wa_id || /^wa-\d+$/.test(a.pcs_slug));
  if (!athletes.length) return "Keine Athleten im Pool – zuerst den Athletenpool laden";
  const names = new Map(athletes.map((a) => [a.pcs_slug, a.name]));

  let api: ApiConfig | null = process.env.WA_API_URL && process.env.WA_API_KEY
    ? { url: process.env.WA_API_URL, key: process.env.WA_API_KEY }
    : null;
  api ??= await discoverApiConfig();

  const jobs = athletes.flatMap((a) => years.map((year) => ({ slug: a.pcs_slug, id: Number(a.wa_id ?? a.pcs_slug.slice(3)), year })));
  const rows: Row[] = [];
  const loaded: { slug: string; year: number }[] = [];
  const failures: string[] = [];
  let rediscovered = false;

  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      try {
        const results = await fetchAthleteResults(api!, job.id, job.year);
        for (const r of results) {
          rows.push({
            rider_slug: job.slug, date: r.date, competition: r.competition, venue: r.venue,
            discipline: r.discipline, country: r.country, category: r.category,
            race: r.race, place: r.place, wa_race: r.race, wa_place: r.place,
            placing_round: null, placing_place: null,
            mark: r.mark, result_score: r.resultScore, remark: r.remark,
            wa_competition_id: r.competitionId, wa_event_id: r.eventId, imported_at: new Date().toISOString(),
          });
        }
        loaded.push(job);
      } catch (e) {
        if (e instanceof ApiAuthError && !rediscovered) {
          rediscovered = true;
          console.warn("API-Key abgelehnt, lese neue Konfiguration von worldathletics.org");
          api = await discoverApiConfig();
          jobs.push(job);
          continue;
        }
        if (e instanceof ApiAuthError) throw e;
        failures.push(`${job.slug}/${job.year}: ${(e as Error).message}`);
      }
      await sleep(300 + Math.random() * 500);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (failures.length > athletes.length / 4) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 50).join("\n")}`);

  // Doppelte Schlüssel innerhalb eines Batches würden den Upsert abbrechen.
  const key = (r: Row) => [r.rider_slug, r.date, r.discipline, r.wa_race, r.competition].join("|");
  const unique = [...new Map(rows.map((r) => [key(r), r])).values()];

  const placings = await resolveEventPlacings(unique, api!, years, names);

  await chunked(unique, 500, async (chunk) => {
    const { error } = await db.from("wa_results").upsert(chunk, { onConflict: "rider_slug,date,discipline,wa_race,competition" });
    if (error) throw new Error(`wa_results: ${error.message}`);
  });
  // Ergebnisse, die WA nicht mehr führt (Korrekturen), für die erfolgreich geladenen Athleten entfernen
  for (const year of years) {
    const slugs = loaded.filter((l) => l.year === year).map((l) => l.slug);
    await chunked(slugs, 100, async (chunk) => {
      const { error } = await db.from("wa_results").delete().in("rider_slug", chunk)
        .gte("date", `${year}-01-01`).lte("date", `${year}-12-31`).lt("imported_at", started);
      if (error) throw new Error(`wa_results löschen: ${error.message}`);
    });
  }

  // Wettkämpfe
  const races = new Map<string, Row>();
  for (const r of unique) {
    if (!r.wa_competition_id) continue;
    const slug = `wa-c${r.wa_competition_id}`;
    const prev = races.get(slug);
    const d = String(r.date);
    races.set(slug, {
      pcs_slug: slug, name: r.competition, venue: r.venue, country: r.country, uci_class: r.category,
      start_date: prev && String(prev.start_date) < d ? prev.start_date : d,
      end_date: prev && String(prev.end_date) > d ? prev.end_date : d,
      loaded_at: started,
    });
  }
  await chunked([...races.values()], 500, async (chunk) => {
    const { error } = await db.from("races").upsert(chunk, { onConflict: "pcs_slug" });
    if (error) throw new Error(`races: ${error.message}`);
  });

  // Punkte, Saisonwertung, Stichtage
  const scored = await rpc<number>(db, "rebuild_results", { p_from: `${Math.min(...years)}-01-01` });
  for (const y of new Set([...years, currentYear()])) await rpc(db, "refresh_season_stats", { p_year: y });
  await rpc(db, "run_maintenance");
  await db.from("sync_status").update({ last_run: new Date().toISOString(), ok: failures.length === 0,
    message: failures.length ? `${failures.length} Athleten nicht geladen` : null }).eq("id", 1);

  return `Ergebnisse: ${unique.length} für ${athletes.length} Athleten (${years.join(", ")}), ${scored} mit Punkten; ` +
    `${placings}` + (failures.length ? `\n${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
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

  const key = (r: Row) => [r.rider_slug, r.date, r.discipline, r.wa_race, r.competition].join("|");
  type Known = { rider_slug: string; date: string; discipline: string; wa_race: string; competition: string;
                 race: string; place: number | null; placing_round: string | null; placing_place: number | null };
  const known = new Map<string, Known>();
  const prev = await selectAll<Known>((a, b) => db.from("wa_results")
    .select("rider_slug, date, discipline, wa_race, competition, race, place, placing_round, placing_place")
    .or("race.eq.F,placing_round.not.is.null").neq("wa_race", "F").neq("wa_race", "")
    .gte("date", `${Math.min(...years)}-01-01`).lte("date", `${Math.max(...years)}-12-31`)
    .order("id").range(a, b));
  for (const r of prev) known.set(key(r), r);
  const who = (r: Row) => ({ id: Number(String(r.rider_slug).slice(3)), name: names.get(String(r.rider_slug)) });

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
