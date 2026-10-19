// Lädt die DE-Toplisten (Saisonjahr + Vorjahr) und speichert alle Athleten über der
// Pool-Schwelle in `athletes` / `toplist_entries`. Der Pool selbst ist die View `season_pool`.
import { COUNTRY, TOPLIST_DISCIPLINES } from "./disciplines";
import { activeSeasons, adminClient, chunked, logRun } from "./supabase";
import { fetchToplist, sleep, type Gender } from "./wa";

const db = adminClient();

await logRun(db, "pool", async () => {
  const seasons = await activeSeasons(db);
  const years = [...new Set(seasons.flatMap((s) => [s.year, s.year - 1]))];
  const minScore = Math.min(...seasons.map((s) => s.pool_threshold));

  const athletes = new Map<number, { id: number; name: string; gender: Gender; birth_year: number | null }>();
  const entries = new Map<string, { athlete_id: number; year: number; discipline: string; mark: string; score: number }>();
  const failures: string[] = [];

  for (const year of years) {
    for (const d of TOPLIST_DISCIPLINES) {
      for (const gender of ["M", "W"] as Gender[]) {
        try {
          const rows = await fetchToplist(d.path, gender, year, COUNTRY, minScore);
          for (const r of rows) {
            athletes.set(r.athleteId, { id: r.athleteId, name: r.name, gender, birth_year: r.birthYear });
            const key = `${r.athleteId}|${year}|${d.name}`;
            const prev = entries.get(key);
            if (!prev || prev.score < r.score) {
              entries.set(key, { athlete_id: r.athleteId, year, discipline: d.name, mark: r.mark, score: r.score });
            }
          }
          console.log(`${year} ${d.name} ${gender}: ${rows.length}`);
        } catch (e) {
          failures.push(`${year} ${d.name} ${gender}: ${(e as Error).message}`);
        }
        await sleep(300);
      }
    }
  }

  const now = new Date().toISOString();
  await chunked([...athletes.values()], 500, async (chunk) => {
    const { error } = await db.from("athletes").upsert(chunk.map((a) => ({ ...a, updated_at: now })));
    if (error) throw error;
  });
  await chunked([...entries.values()], 500, async (chunk) => {
    const { error } = await db.from("toplist_entries").upsert(chunk.map((e) => ({ ...e, updated_at: now })));
    if (error) throw error;
  });

  const total = TOPLIST_DISCIPLINES.length * 2 * years.length;
  if (failures.length > total / 2) throw new Error(`Zu viele Fehler:\n${failures.join("\n")}`);
  return `Pool: ${athletes.size} Athleten, ${entries.size} Toplisteneinträge (Jahre ${years.join(", ")}, ab ${minScore} Punkten)` +
    (failures.length ? `\nFehler:\n${failures.join("\n")}` : "");
});
