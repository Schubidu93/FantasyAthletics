// Ergebnisabruf von Anfang bis Ende: Importer (eigener Prozess) gegen den Nachbau der Supabase-Schnittstelle
// (tests/ui/mock-api.ts, lokale Datenbank) und einen Nachbau der WA-Schnittstelle in diesem Test.
// Geprüft wird vor allem, dass nur geladen wird, was nötig ist.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, urlFor, type Db } from "./db";

const run = promisify(execFile);
const Y = new Date().getFullYear();
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const waDate = (iso: string) => `${iso.slice(8, 10)} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

// --- Nachbau WA ------------------------------------------------------------------------------
type Res = { date: string; competition: string; discipline: string; race: string; place: string; mark: string; resultScore: number; category: string; competitionId: number; eventId: number };
const wa = new Map<number, Res[]>();       // Athleten-ID -> Ergebnisse
const calls = { feed: 0, single: [] as string[], other: 0 };
let waServer: Server;
let waUrl = "";

function handleWa(body: { operationName?: string; variables?: Record<string, unknown> }) {
  if (body.operationName === "ResultsByAthlete") {
    calls.feed++;
    const ids = (body.variables!.ids as string[]).map(Number);
    const cutoff = day(-30);
    return { data: { resultsByAthlete: { results: ids.flatMap((id) => (wa.get(id) ?? []).filter((r) => r.date >= cutoff).map((r) => ({
      athlete: { id }, competition: r.competition, date: waDate(r.date), discipline: r.discipline, mark: r.mark, place: r.place, race: r.race.toLowerCase(),
    }))) } } };
  }
  if (body.operationName === "GetSingleCompetitorResultsDate") {
    const { id, resultsByYear } = body.variables as { id: number; resultsByYear: number };
    calls.single.push(`${id}/${resultsByYear}`);
    return { data: { getSingleCompetitorResultsDate: { resultsByDate: (wa.get(id) ?? [])
      .filter((r) => r.date.startsWith(String(resultsByYear)))
      .map((r) => ({ ...r, date: waDate(r.date), venue: "Ort (GER)", country: "GER", remark: null })) } } };
  }
  calls.other++;
  return { data: null };
}

// --- Ablauf ----------------------------------------------------------------------------------
let db: Db;
let api: ChildProcess;
const PORT = 54391 + Math.floor(Math.random() * 500);
const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x`;

async function importer(modus: string) {
  calls.feed = 0; calls.single = []; calls.other = 0;
  const { stdout } = await run("npx", ["tsx", "importer/sync-results.ts"], {
    env: { ...process.env, MODUS: modus, SUPABASE_URL: `http://localhost:${PORT}`, SUPABASE_SERVICE_KEY: serviceJwt,
           WA_API_URL: waUrl, WA_API_KEY: "test", WA_CONCURRENCY: "2", RESULT_YEARS: String(Y) },
  });
  return stdout.trim();
}
const stored = async () => (await db.all(
  "select athlete_id, date::text, discipline, mark, result_score from wa_results order by athlete_id, date, discipline"))
  .map((r) => `${r.athlete_id} ${r.date} ${r.discipline} ${r.mark} ${r.result_score}`);
const res = (date: string, discipline: string, mark: string, score: number, comp = 7400100): Res =>
  ({ date, competition: `Meeting ${comp}`, discipline, race: "F", place: "1.", mark, resultScore: score, category: "F", competitionId: comp, eventId: 1 });

beforeAll(async () => {
  db = await freshDb();
  await athlete(db, 101, "Läufer A", "men", "800 Metres", 1150);
  await athlete(db, 102, "Läuferin B", "women", "1500 Metres", 1150);
  await athlete(db, 103, "Läufer C", "men", "5000 Metres", 1150);
  await db.query("select refresh_pool(null)");
  waServer = createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(handleWa(JSON.parse(b))));
  });
  await new Promise<void>((r) => waServer.listen(0, r));
  waUrl = `http://localhost:${(waServer.address() as { port: number }).port}/graphql`;
  api = spawn(process.execPath, ["--import", "tsx", "tests/ui/mock-api.ts"], { env: { ...process.env, DATABASE_URL: urlFor((db as unknown as { database: string }).database), PORT: String(PORT) }, stdio: "pipe" });
  await new Promise<void>((resolve) => api.stdout!.on("data", (d) => String(d).includes("Mock-API") && resolve()));
});
afterAll(async () => {
  api.kill();
  await new Promise((r) => api.once("exit", r));
  waServer.close();
  await db.end();
});

describe("Ergebnisabruf", () => {
  it("nachts: neue Athleten einmal komplett (aktuelles Jahr und Vorjahr)", async () => {
    wa.set(101, [res(day(-60), "800 Metres", "1:46.00", 1150, 7400101), res(day(-5), "800 Metres", "1:45.50", 1160)]);
    wa.set(102, [res(day(-40), "1500 Metres", "4:05.00", 1120)]);
    const out = await importer("nacht");
    expect(out).toMatch(/3 neue Athleten/);
    expect(calls.single.sort()).toEqual([`101/${Y - 1}`, `101/${Y}`, `102/${Y - 1}`, `102/${Y}`, `103/${Y - 1}`, `103/${Y}`].sort());
    expect(await stored()).toHaveLength(3);
    expect(Number((await db.one("select count(*) n from results")).n)).toBe(3);

    // zweite Nacht: nur noch ein Siebtel zur Kontrolle (bei 3 Athleten: einer) ...
    await importer("nacht");
    expect(calls.single).toHaveLength(1);
    // ... plus alle Kader-Athleten
    const u = await createUser(db, "admin");
    await as(db, u);
    const lg = (await db.one("select create_league('Liga', 'Team', '{}') id")).id;
    const mgr = (await db.one("select id from managers where league_id = $1", [lg])).id;
    await db.query("insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on) values ($1, $2, 'wa-103', 1, 'offline', $3)", [lg, mgr, day(0)]);
    await importer("nacht");
    expect(calls.single).toContain(`103/${Y}`);
    expect(calls.single).toHaveLength(2);   // wa-103 (Kader) + eines der beiden übrigen
  });

  it("stündlich: nur ein Sammelabruf, Einzelabruf nur bei Neuem", async () => {
    // erster Lauf kennt den Stand noch nicht: Athlet mit Ergebnis der letzten 30 Tage wird einmal geladen
    await importer("neu");
    expect(calls.feed).toBe(1);
    expect(calls.single).toEqual([`101/${Y}`]);
    // nichts Neues: kein Einzelabruf
    expect(await importer("neu")).toMatch(/nichts zu laden/);
    expect(calls).toEqual({ feed: 1, single: [], other: 0 });
  });

  it("schrittweise hochgeladene Wettkämpfe und Korrekturen", async () => {
    // Meeting: erst 800 m von A ...
    wa.get(101)!.push(res(day(0), "800 Metres", "1:44.90", 1175, 7400200));
    await importer("neu");
    expect(calls.single).toEqual([`101/${Y}`]);
    // ... Stunden später 1500 m von B und eine zweite Disziplin von A
    wa.get(102)!.push(res(day(0), "1500 Metres", "3:59.00", 1180, 7400200));
    wa.get(101)!.push(res(day(0), "1500 Metres", "3:40.00", 1165, 7400200));
    await importer("neu");
    expect(calls.single.sort()).toEqual([`101/${Y}`, `102/${Y}`]);
    // Korrektur der Zeit
    wa.get(102)!.at(-1)!.mark = "3:59.10";
    wa.get(102)!.at(-1)!.resultScore = 1179;
    await importer("neu");
    expect(calls.single).toEqual([`102/${Y}`]);
    expect(await stored()).toContain(`wa-102 ${day(0)} 1500 Metres 3:59.10 1179`);
    // gelöschtes Ergebnis verschwindet beim nächsten Komplettabruf des Athleten
    wa.get(101)!.splice(1, 1);
    // Nachträge (z. B. RaceResult) überstehen den Komplettabruf
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, race, wa_race, mark, result_score, source)
                    values ('wa-103', $1, 'Stadtlauf', '10 Kilometres Road', 'F', 'F', '29:00', 1200, 'manual')`, [day(-3)]);
    await importer("voll");
    expect((await db.one("select count(*)::int n from wa_results where source = 'manual'")).n).toBe(1);
    expect(calls.single).toHaveLength(3);
    expect((await stored()).filter((s) => s.startsWith("wa-101"))).toHaveLength(3);
    expect(Number((await db.one("select count(*) n from results where athlete_id = 'wa-101'")).n)).toBe(3);
  });
});
