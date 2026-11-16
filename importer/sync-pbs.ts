// Persönliche Bestleistungen aller Athleten von World Athletics (eine Abfrage je Athlet):
// - athlete_pbs: aktuelle Bestleistungen fürs Profil
// - athlete_pb_before: beste Leistung vor 2025 je Disziplin (Grundlage für den PB-Bonus, ab 2025 kennt die App alle Ergebnisse)
// Täglich im Ablauf „Athletenpool laden“. Danach werden die Punkte ab 2025 neu berechnet.
import { bestBefore, currentPbs, type RawPb, type RawProgression } from "./pbs";
import { adminClient, chunked, currentYear, rpc, selectAll } from "./supabase";
import { discoverApiConfig, sleep, type ApiConfig } from "./wa";

const db = adminClient();
const FIRST_YEAR = 2025;
const QUERY = `query($id: Int) { getSingleCompetitor(id: $id) {
  personalBests { results { indoor discipline mark notLegal venue date resultScore } }
  progressionOfSeasonsBests { discipline indoor results { season mark date } } } }`;

async function load(api: ApiConfig, id: number) {
  const res = await fetch(api.url, { method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" },
    body: JSON.stringify({ query: QUERY, variables: { id } }) });
  if (res.status === 429) throw new Error("WA bremst (429)");
  if (!res.ok) throw new Error(`WA-API ${res.status}`);
  const body = (await res.json()) as { data?: { getSingleCompetitor?: { personalBests?: { results?: RawPb[] }; progressionOfSeasonsBests?: RawProgression[] } };
                                       errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  const c = body.data?.getSingleCompetitor;
  return { pbs: c?.personalBests?.results ?? [], progression: c?.progressionOfSeasonsBests ?? [] };
}

const main = async () => {
  const api: ApiConfig = process.env.WA_API_URL && process.env.WA_API_KEY
    ? { url: process.env.WA_API_URL, key: process.env.WA_API_KEY } : await discoverApiConfig();
  const known = new Set((await selectAll<{ name: string }>((a, b) => db.from("disciplines").select("name").order("name").range(a, b))).map((d) => d.name));
  const athletes = await selectAll<{ id: string; wa_id: number }>((a, b) => db.from("athletes").select("id, wa_id").order("id").range(a, b));
  const pbs: ReturnType<typeof currentPbs> = [];
  const before: ReturnType<typeof bestBefore> = [];
  const done: string[] = [];
  const failures: string[] = [];
  for (const a of athletes) {
    if (!a.wa_id) continue;
    try {
      const r = await load(api, Number(a.wa_id));
      pbs.push(...currentPbs(a.id, r.pbs, known));
      before.push(...bestBefore(a.id, r.progression, FIRST_YEAR, known));
      done.push(a.id);
    } catch (e) {
      failures.push(`${a.id}: ${(e as Error).message}`);
      if (/429/.test((e as Error).message)) break;
    }
    await sleep(600);
  }
  if (failures.length > Math.max(10, athletes.length / 4)) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 20).join("\n")}`);
  // je erfolgreich geladenem Athleten ersetzen
  for (const [table, rows] of [["athlete_pbs", pbs], ["athlete_pb_before", before]] as const) {
    await chunked(done, 200, async (chunk) => {
      const { error } = await db.from(table).delete().in("athlete_id", chunk);
      if (error) throw new Error(`${table} löschen: ${error.message}`);
    });
    await chunked(rows as Record<string, unknown>[], 500, async (chunk) => {
      const { error } = await db.from(table).insert(chunk);
      if (error) throw new Error(`${table}: ${error.message}`);
    });
  }
  // PB-Bonus hängt an athlete_pb_before → Punkte ab 2025 neu
  const scored = await rpc<number>(db, "rebuild_results", { p_from: `${FIRST_YEAR}-01-01` });
  for (let y = FIRST_YEAR; y <= currentYear(); y++) await rpc(db, "refresh_season_stats", { p_year: y });
  const bonus = await selectAll<{ id: number }>((a, b) => db.from("results").select("id").gt("pb_points", 0).order("id").range(a, b));
  return `Bestleistungen: ${done.length} Athleten geladen, ${pbs.length} PBs, ${before.length} Bestleistungen vor ${FIRST_YEAR}; ` +
    `${scored} Ergebnisse gewertet, davon ${bonus.length} mit PB-Bonus` +
    (failures.length ? `\n${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
};

try {
  console.log(await main());
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e));
  process.exitCode = 1;
}
