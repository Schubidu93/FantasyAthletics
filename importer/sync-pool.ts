// Athletenpool: lädt die DE-Toplisten (aktuelles Jahr + Vorjahr), speichert alle Athleten über der
// Pool-Schwelle in riders/toplist_entries und berechnet danach Pool-Rang und Disziplingruppe (refresh_pool).
import { COUNTRY, TOPLIST_DISCIPLINES } from "./disciplines";
import { adminClient, chunked, currentYear, rpc, run } from "./supabase";
import { fetchToplist, sleep, type Gender } from "./wa";

const db = adminClient();

await run(db, async () => {
  const year = currentYear();
  const years = [year, year - 1];
  const { data: cfg, error } = await db.from("scoring_config").select("pool_threshold").eq("id", 1).single();
  if (error) throw error;
  const minScore = cfg.pool_threshold as number;

  const athletes = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, { rider_slug: string; year: number; discipline: string; mark: string; score: number }>();
  const failures: string[] = [];

  for (const y of years) {
    for (const d of TOPLIST_DISCIPLINES) {
      for (const gender of ["M", "W"] as Gender[]) {
        try {
          const rows = await fetchToplist(d.path, gender, y, COUNTRY, minScore);
          for (const r of rows) {
            const slug = `wa-${r.athleteId}`;
            athletes.set(slug, {
              pcs_slug: slug, wa_id: r.athleteId, name: r.name, gender: gender === "M" ? "men" : "women",
              nation: "GER", ...(r.birthDate ? { birth_date: r.birthDate } : {}),
            });
            const key = `${slug}|${y}|${d.name}`;
            const prev = entries.get(key);
            if (!prev || prev.score < r.score) entries.set(key, { rider_slug: slug, year: y, discipline: d.name, mark: r.mark, score: r.score });
          }
          console.log(`${y} ${d.name} ${gender}: ${rows.length}`);
        } catch (e) {
          failures.push(`${y} ${d.name} ${gender}: ${(e as Error).message}`);
        }
        await sleep(300);
      }
    }
  }
  const total = TOPLIST_DISCIPLINES.length * 2 * years.length;
  if (failures.length > total / 2) throw new Error(`Zu viele Fehler beim Laden der Toplisten:\n${failures.join("\n")}`);

  const now = new Date().toISOString();
  // Zeilen mit und ohne Geburtsdatum getrennt speichern (ein Upsert braucht überall dieselben Spalten)
  const list = [...athletes.values()];
  for (const part of [list.filter((a) => a.birth_date), list.filter((a) => !a.birth_date)]) {
    await chunked(part, 500, async (chunk) => {
      const { error } = await db.from("riders").upsert(chunk.map((a) => ({ ...a, updated_at: now })), { onConflict: "pcs_slug" });
      if (error) throw new Error(`riders: ${error.message}`);
    });
  }
  await chunked([...entries.values()], 500, async (chunk) => {
    const { error } = await db.from("toplist_entries").upsert(chunk.map((e) => ({ ...e, updated_at: now })),
      { onConflict: "rider_slug,year,discipline" });
    if (error) throw new Error(`toplist_entries: ${error.message}`);
  });
  const pool = await rpc<number>(db, "refresh_pool", { p_year: year });

  return `Pool: ${pool} Athleten (ab ${minScore} WA-Punkten, Toplisten ${years.join(" + ")}), ` +
    `${athletes.size} Athleten und ${entries.size} Toplisteneinträge geladen` +
    (failures.length ? `\nFehler:\n${failures.join("\n")}` : "");
});
