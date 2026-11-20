// Athletenpool: lädt die DE-Toplisten (aktuelles Jahr + Vorjahr), speichert alle Athleten über der
// Pool-Schwelle in athletes/toplist_entries und berechnet danach Pool-Rang und Disziplingruppe (refresh_pool).
import { COUNTRY, gendersOf, TOPLIST_DISCIPLINES } from "./disciplines";
import { adminClient, chunked, currentYear, rpc, run, selectAll } from "./supabase";
import { fetchToplist, sleep } from "./wa";

const db = adminClient();

await run(db, async () => {
  const year = currentYear();
  const years = [year, year - 1];
  const { data: cfg, error } = await db.from("scoring_config").select("pool_threshold").eq("id", 1).single();
  if (error) throw error;
  const minScore = cfg.pool_threshold as number;

  const athletes = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, { athlete_id: string; year: number; discipline: string; mark: string; score: number }>();
  const failures: string[] = [];

  for (const y of years) {
    for (const d of TOPLIST_DISCIPLINES) {
      for (const gender of gendersOf(d)) {
        try {
          const rows = await fetchToplist(d.path, gender, y, COUNTRY, minScore);
          for (const r of rows) {
            const slug = `wa-${r.athleteId}`;
            athletes.set(slug, {
              id: slug, wa_id: r.athleteId, name: r.name, gender: gender === "M" ? "men" : "women",
              ...(r.birthDate ? { birth_date: r.birthDate } : {}),
            });
            const key = `${slug}|${y}|${d.name}`;
            const prev = entries.get(key);
            if (!prev || prev.score < r.score) entries.set(key, { athlete_id: slug, year: y, discipline: d.name, mark: r.mark, score: r.score });
          }
          console.log(`${y} ${d.name} ${gender}: ${rows.length}`);
        } catch (e) {
          failures.push(`${y} ${d.name} ${gender}: ${(e as Error).message}`);
        }
        await sleep(300);
      }
    }
  }
  const total = TOPLIST_DISCIPLINES.reduce((n, d) => n + gendersOf(d).length, 0) * years.length;
  if (failures.length > total / 2) throw new Error(`Zu viele Fehler beim Laden der Toplisten:\n${failures.join("\n")}`);

  const now = new Date().toISOString();
  // Namen setzt die Topliste nur bei neuen Athleten: Namenswechsel (z. B. nach Hochzeit) übernimmt sync-pbs aus dem
  // WA-Profil, ältere Toplisten führen oft noch den alten Namen
  // (der Name muss trotzdem mitgeschickt werden – Upsert prüft „nicht leer“ schon vor dem Abgleich –, also der gespeicherte)
  const known = new Map((await selectAll<{ id: string; name: string }>((a, b) => db.from("athletes").select("id, name").order("id").range(a, b)))
    .map((a) => [a.id, a.name]));
  const list = [...athletes.values()].map((a) => ({ ...a, name: known.get(a.id as string) ?? a.name }));
  // Zeilen getrennt nach vorhandenen Spalten speichern (ein Upsert braucht überall dieselben Spalten)
  const parts = new Map<string, Record<string, unknown>[]>();
  for (const a of list) { const k = Object.keys(a).sort().join(","); parts.set(k, [...(parts.get(k) ?? []), a]); }
  for (const part of parts.values()) {
    await chunked(part, 500, async (chunk) => {
      const { error } = await db.from("athletes").upsert(chunk.map((a) => ({ ...a, updated_at: now })), { onConflict: "id" });
      if (error) throw new Error(`athletes: ${error.message}`);
    });
  }
  await chunked([...entries.values()], 500, async (chunk) => {
    const { error } = await db.from("toplist_entries").upsert(chunk.map((e) => ({ ...e, updated_at: now })),
      { onConflict: "athlete_id,year,discipline" });
    if (error) throw new Error(`toplist_entries: ${error.message}`);
  });
  const pool = await rpc<number>(db, "refresh_pool", { p_year: year });

  return `Pool: ${pool} Athleten (ab ${minScore} WA-Punkten, Toplisten ${years.join(" + ")}), ` +
    `${athletes.size} Athleten und ${entries.size} Toplisteneinträge geladen` +
    (failures.length ? `\nFehler:\n${failures.join("\n")}` : "");
});
