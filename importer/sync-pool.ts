// Athletenpool: lädt die Toplisten aller Länder aus pool_nations (aktuelles Jahr + Vorjahr), speichert alle Athleten über der
// Pool-Schwelle des Landes in athletes/toplist_entries und berechnet danach Pool-Rang und Disziplingruppe (refresh_pool).
import { gendersOf, TOPLIST_DISCIPLINES } from "./disciplines";
import { adminClient, chunked, currentYear, rpc, run, selectAll } from "./supabase";
import { fetchToplist, sleep } from "./wa";

const db = adminClient();

await run(db, async () => {
  const year = currentYear();
  const years = [year, year - 1];
  const { data: cfg, error } = await db.from("scoring_config").select("pool_threshold").eq("id", 1).single();
  if (error) throw error;
  const { data: nations, error: e2 } = await db.from("pool_nations").select("code, wa_code, threshold").order("sort");
  if (e2) throw e2;

  const athletes = new Map<string, Record<string, unknown>>();
  const entries = new Map<string, { athlete_id: string; year: number; discipline: string; mark: string; score: number }>();
  const failures: string[] = [];

  for (const n of nations as { code: string; wa_code: string; threshold: number | null }[]) {
  const minScore = (n.threshold ?? cfg.pool_threshold) as number;
  for (const y of years) {
    for (const d of TOPLIST_DISCIPLINES) {
      for (const gender of gendersOf(d)) {
        try {
          const rows = await fetchToplist(d.path, gender, y, n.wa_code, minScore);
          for (const r of rows) {
            const slug = `wa-${r.athleteId}`;
            athletes.set(slug, {
              id: slug, wa_id: r.athleteId, name: r.name, gender: gender === "M" ? "men" : "women", nation: n.code,
              ...(r.birthDate ? { birth_date: r.birthDate } : {}),
            });
            const key = `${slug}|${y}|${d.name}`;
            const prev = entries.get(key);
            if (!prev || prev.score < r.score) entries.set(key, { athlete_id: slug, year: y, discipline: d.name, mark: r.mark, score: r.score });
          }
          console.log(`${n.code} ${y} ${d.name} ${gender}: ${rows.length}`);
        } catch (e) {
          failures.push(`${n.code} ${y} ${d.name} ${gender}: ${(e as Error).message}`);
        }
        await sleep(300);
      }
    }
  }
  }
  const total = TOPLIST_DISCIPLINES.reduce((n, d) => n + gendersOf(d).length, 0) * years.length * nations.length;
  if (failures.length > total / 2) throw new Error(`Zu viele Fehler beim Laden der Toplisten:\n${failures.join("\n")}`);

  const now = new Date().toISOString();
  // Namen setzt die Topliste nur bei neuen Athleten: Namenswechsel (z. B. nach Hochzeit) übernimmt sync-pbs aus dem
  // WA-Profil, ältere Toplisten führen oft noch den alten Namen
  // (der Name muss trotzdem mitgeschickt werden – Upsert prüft „nicht leer“ schon vor dem Abgleich –, also der gespeicherte)
  const known = new Map((await selectAll<{ id: string; name: string }>((a, b) => db.from("athletes").select("id, name").order("id").range(a, b)))
    .map((a) => [a.id, a.name]));
  // bekannte Athleten behalten Namen und Nation (beides kommt aus dem WA-Profil, siehe sync-pbs); neue bekommen das Land der Topliste
  const list = [...athletes.values()].map((a) => {
    if (!known.has(a.id as string)) return a;
    const { nation: _n, ...rest } = a;
    return { ...rest, name: known.get(a.id as string) };
  });
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

  const limits = (nations as { code: string; threshold: number | null }[]).map((n) => `${n.code} ab ${n.threshold ?? cfg.pool_threshold}`).join(", ");
  return `Pool: ${pool} Athleten (${limits} WA-Punkten, Toplisten ${years.join(" + ")}), ` +
    `${athletes.size} Athleten und ${entries.size} Toplisteneinträge geladen` +
    (failures.length ? `\nFehler:\n${failures.join("\n")}` : "");
});
