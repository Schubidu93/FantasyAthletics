// Lädt die Ergebnisse aller Pool-Athleten der laufenden Saisons von der WA-GraphQL-API.
import { activeSeasons, adminClient, chunked, logRun } from "./supabase";
import { combinedPlace, fetchEventRaces, isSplitFinal, type Race } from "./finals";
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

  const combined = await resolveSplitFinals([...unique.values()], api!, years);

  await chunked([...unique.values()], 500, async (chunk) => {
    const { error } = await db.from("results").upsert(chunk, { onConflict: "athlete_id,date,discipline,wa_race,competition" });
    if (error) throw error;
  });

  if (failures.length > athleteIds.size / 4) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 50).join("\n")}`);
  return `Ergebnisse: ${unique.size} Ergebnisse für ${athleteIds.size} Athleten (${years.join(", ")}), ${combined}` +
    (failures.length ? `, ${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
});

/**
 * Finals mit mehreren Läufen (F1, F2, ...): kombinierte Platzierung über alle Finalläufe
 * ermitteln und als Lauf "F" werten. Bereits aufgelöste Ergebnisse werden aus der DB übernommen,
 * die Detailergebnisse je Event nur einmal geladen.
 */
async function resolveSplitFinals(rows: Record<string, unknown>[], api: ApiConfig, years: number[]) {
  const split = rows.filter((r) => isSplitFinal(String(r.wa_race)));
  if (!split.length) return "keine geteilten Finals";

  const known = new Map<string, number>();
  const { data, error } = await db.from("results").select("athlete_id, date, discipline, wa_race, competition, place")
    .like("wa_race", "F%").eq("race", "F")
    .gte("date", `${Math.min(...years)}-01-01`).lte("date", `${Math.max(...years)}-12-31`);
  if (error) throw error;
  for (const r of data ?? []) {
    known.set([r.athlete_id, r.date, r.discipline, r.wa_race, r.competition].join("|"), r.place);
  }

  const events = new Map<string, Promise<Race[]>>();
  let resolved = 0;
  let missing = 0;
  for (const r of split) {
    const k = [r.athlete_id, r.date, r.discipline, r.wa_race, r.competition].join("|");
    let place = known.get(k) ?? null;
    if (place === null && r.wa_competition_id && r.wa_event_id) {
      const ek = `${r.wa_competition_id}:${r.wa_event_id}`;
      if (!events.has(ek)) {
        events.set(ek, sleep(500).then(() => fetchEventRaces(api, Number(r.wa_competition_id), Number(r.wa_event_id))).catch((e) => {
          console.warn(`Detailergebnisse ${ek}: ${(e as Error).message}`);
          return [];
        }));
      }
      place = combinedPlace(await events.get(ek)!, r.mark as string | null);
    }
    if (place !== null) {
      r.race = "F";
      r.place = place;
      resolved++;
    } else {
      // Ohne kombinierte Platzierung bleibt es beim Lauf F1/F2 -> keine Platzierungspunkte.
      missing++;
      console.warn(`Keine kombinierte Platzierung für ${k}`);
    }
  }
  return `${resolved} geteilte Finals kombiniert` + (missing ? `, ${missing} offen` : "");
}
