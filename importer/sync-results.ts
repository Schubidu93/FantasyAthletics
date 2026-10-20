// Lädt die Ergebnisse aller Pool-Athleten der laufenden Saisons von der WA-GraphQL-API.
import { activeSeasons, adminClient, chunked, logRun } from "./supabase";
import { combinedPlace, fetchEventRaces, isPrelimRace, isSplitFinal, prelimPlacing, PRELIM_CATEGORIES, type Race } from "./placings";
import { ApiAuthError, discoverApiConfig, fetchAthleteResults, sleep, type ApiConfig } from "./wa";

const CONCURRENCY = Number(process.env.WA_CONCURRENCY ?? 3);
const db = adminClient();

await logRun(db, "results", async () => {
  const seasons = await activeSeasons(db);
  const seasonIds = seasons.map((s) => s.id).filter((id) => id !== null);
  const years = [...new Set(seasons.map((s) => s.year))];

  const athleteIds = new Set<number>();
  if (seasonIds.length) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("season_pool").select("athlete_id")
        .in("season_id", seasonIds).range(from, from + 999);
      if (error) throw error;
      data.forEach((r) => athleteIds.add(Number(r.athlete_id)));
      if (data.length < 1000) break;
    }
  }
  if (!athleteIds.size) return "Keine Athleten im Pool – erst sync-pool ausführen";

  let api: ApiConfig | null = process.env.WA_API_URL && process.env.WA_API_KEY
    ? { url: process.env.WA_API_URL, key: process.env.WA_API_KEY }
    : null;
  api ??= await discoverApiConfig();

  const jobs = [...athleteIds].flatMap((id) => years.map((year) => ({ id, year })));
  const rows: Record<string, unknown>[] = [];
  const failures: string[] = [];
  let rediscovered = false;

  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      try {
        const results = await fetchAthleteResults(api!, job.id, job.year);
        for (const r of results) {
          rows.push({
            athlete_id: job.id, date: r.date, competition: r.competition, venue: r.venue,
            discipline: r.discipline, country: r.country, category: r.category,
            race: r.race, place: r.place, wa_race: r.race, wa_place: r.place,
            mark: r.mark, result_score: r.resultScore, remark: r.remark,
            wa_competition_id: r.competitionId, wa_event_id: r.eventId, imported_at: new Date().toISOString(),
          });
        }
      } catch (e) {
        if (e instanceof ApiAuthError && !rediscovered) {
          rediscovered = true;
          console.warn("API-Key abgelehnt, lese neue Konfiguration von worldathletics.org");
          api = await discoverApiConfig();
          jobs.push(job);
          continue;
        }
        if (e instanceof ApiAuthError) throw e;
        failures.push(`${job.id}/${job.year}: ${(e as Error).message}`);
      }
      await sleep(300 + Math.random() * 500);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Doppelte Schlüssel innerhalb eines Batches würden den Upsert abbrechen.
  const key = (r: Record<string, unknown>) => [r.athlete_id, r.date, r.discipline, r.wa_race, r.competition].join("|");
  const unique = new Map(rows.map((r) => [key(r), r]));

  const combined = await resolveEventPlacings([...unique.values()], api!, years);

  await chunked([...unique.values()], 500, async (chunk) => {
    const { error } = await db.from("results").upsert(chunk, { onConflict: "athlete_id,date,discipline,wa_race,competition" });
    if (error) throw error;
  });

  if (failures.length > athleteIds.size / 4) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 50).join("\n")}`);
  return `Ergebnisse: ${unique.size} Ergebnisse für ${athleteIds.size} Athleten (${years.join(", ")}), ${combined}` +
    (failures.length ? `, ${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
});

/**
 * Platzierungen aus den Detailergebnissen des Events:
 * - Finals mit mehreren Läufen (F1, F2, ...) -> kombinierte Platzierung, gewertet als Lauf "F"
 * - letzte Runde vor dem Finale bei OW/DF/GW/GL -> placing_round P9/P10, placing_place (0 = Q/q)
 * Bereits aufgelöste Ergebnisse werden aus der DB übernommen, jedes Event nur einmal geladen.
 */
async function resolveEventPlacings(rows: Record<string, unknown>[], api: ApiConfig, years: number[]) {
  const split = rows.filter((r) => isSplitFinal(String(r.wa_race)));
  const prelims = rows.filter((r) => isPrelimRace(String(r.wa_race)) && PRELIM_CATEGORIES.includes(String(r.category)));
  if (!split.length && !prelims.length) return "keine Detailergebnisse nötig";

  const key = (r: Record<string, unknown>) => [r.athlete_id, r.date, r.discipline, r.wa_race, r.competition].join("|");
  const known = new Map<string, { race: string; place: number | null; placing_round: string | null; placing_place: number | null }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("results")
      .select("athlete_id, date, discipline, wa_race, competition, race, place, placing_round, placing_place")
      .or("race.eq.F,placing_round.not.is.null")
      .neq("wa_race", "F")
      .gte("date", `${Math.min(...years)}-01-01`).lte("date", `${Math.max(...years)}-12-31`)
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) known.set(key(r), r);
    if ((data ?? []).length < 1000) break;
  }

  const ids = [...new Set([...split, ...prelims].map((r) => Number(r.athlete_id)))];
  const names = new Map<number, string>();
  await chunked(ids, 500, async (chunk) => {
    const { data, error } = await db.from("athletes").select("id, name").in("id", chunk);
    if (error) throw error;
    (data ?? []).forEach((a) => names.set(Number(a.id), a.name as string));
  });

  const events = new Map<string, Promise<Race[]>>();
  const racesFor = (r: Record<string, unknown>) => {
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
      place = combinedPlace(await racesFor(r), r.mark as string | null, { id: Number(r.athlete_id), name: names.get(Number(r.athlete_id)) });
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
      placing = prelimPlacing(await racesFor(r), { id: Number(r.athlete_id), name: names.get(Number(r.athlete_id)) });
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
