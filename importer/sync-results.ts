// Lädt die Ergebnisse aller Pool-Athleten der laufenden Saisons von der WA-GraphQL-API.
import { activeSeasons, adminClient, chunked, logRun } from "./supabase";
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
            discipline: r.discipline, country: r.country, category: r.category, race: r.race,
            place: r.place, mark: r.mark, result_score: r.resultScore, remark: r.remark,
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
  const unique = new Map(rows.map((r) => [[r.athlete_id, r.date, r.discipline, r.race, r.competition].join("|"), r]));
  await chunked([...unique.values()], 500, async (chunk) => {
    const { error } = await db.from("results").upsert(chunk, { onConflict: "athlete_id,date,discipline,race,competition" });
    if (error) throw error;
  });

  if (failures.length > athleteIds.size / 4) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 50).join("\n")}`);
  return `Ergebnisse: ${unique.size} Ergebnisse für ${athleteIds.size} Athleten (${years.join(", ")})` +
    (failures.length ? `, ${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
});
