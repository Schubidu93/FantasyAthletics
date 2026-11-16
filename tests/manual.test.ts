// Nachträge: Ergebnisse, die World Athletics nicht führt (z. B. von RaceResult), mit nachgebauter WA-Punkteformel
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, type Db } from "./db";

let db: Db;
let admin: string;
const Y = new Date().getFullYear();
const D = `${Y}-03-01`;

// Erfundene "WA-Tabelle" für 10 km Straße Männer: Punkte = floor(0,0003 · (3800 − t)²)
const table = (t: number) => Math.floor(0.0003 * (3800 - t) ** 2);
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, "admin");
  await as(db, admin);
  await db.query("select create_league('Liga', 'Team', '{}')");
  // WA-Ergebnisse als Datengrundlage: 60 Zeiten zwischen 27:00 und 37:00, dazu zwei falsch erfasste
  for (let i = 0; i < 60; i++) {
    const slug = await athlete(db, 1000 + i, `Läufer ${i}`, "men", "10 Kilometres Road", 1100);
    const t = 1620 + i * 10;
    await db.query(`insert into wa_results (rider_slug, date, competition, discipline, race, wa_race, mark, result_score)
                    values ($1, $2, 'WA-Lauf', '10 Kilometres Road', 'F', 'F', $3, $4)`, [slug, `${Y}-01-10`, fmt(t), table(t)]);
  }
  await db.query(`update wa_results set result_score = 900 where rider_slug in ('wa-1003', 'wa-1040')`);
});
afterEach(async () => {
  await db.end();
});

describe("WA-Punkte aus der Zeit", () => {
  it("liest Zeiten", async () => {
    const r = await db.one(`select mark_seconds('2:09:43') a, mark_seconds('29:18') b, mark_seconds('13:45.12') c,
                                   mark_seconds('29:18,4') d, mark_seconds('1:02:45 h') e, mark_seconds('DNF') f`);
    expect(Object.values(r).map((x) => (x === null ? null : Number(x)))).toEqual([7783, 1758, 825.12, 1758.4, 3765, null]);
  });

  it("baut die Formel aus WA-Ergebnissen nach (Ausreißer werden ignoriert)", async () => {
    expect((await db.one("select fit_scoring_coefficients() n")).n).toBe(1);
    const k = await db.one("select n, exact, max_error from scoring_coefficients where discipline = '10 Kilometres Road' and gender = 'men'");
    expect(k.n).toBe(58);
    // WA rundet ab; die nachgebaute Formel trifft fast immer genau, sonst um 1 Punkt daneben
    expect(Number(k.exact)).toBeGreaterThan(0.95);
    expect(k.max_error).toBeLessThanOrEqual(1);
    for (const t of [1600, 1758, 1900, 2300]) {
      expect(Math.abs((await db.one("select wa_points('10 Kilometres Road', 'men', $1) p", [fmt(t)])).p - table(t))).toBeLessThanOrEqual(1);
    }
    expect((await db.one("select wa_points('10 Kilometres Road', 'women', '29:18') p")).p).toBeNull();   // keine Tabelle
    expect((await db.one("select wa_points('10 Kilometres Road', 'men', '1:10:00') p")).p).toBe(0);     // jenseits der Tabelle
  });
});

describe("Ergebnisse nachtragen", () => {
  beforeEach(async () => {
    await db.query("select fit_scoring_coefficients()");
    await athlete(db, 1, "Filimon ABRAHAM", "men", "Marathon", 1150);
  });
  const add = (p: Record<string, unknown>) => db.one("select add_manual_result($1) id",
    [{ rider_slug: "wa-1", date: D, discipline: "10 Kilometres Road", competition: "Stadtlauf", source_url: "https://my.raceresult.com/123", ...p }]);
  const points = async () => (await db.all("select label, perf_points from results where rider_slug = 'wa-1'"))
    .map((r) => [r.label, Number(r.perf_points)]);

  it("berechnet WA-Punkte, zählt in der Wertung und ist als Nachtrag gekennzeichnet", async () => {
    const check = await db.one("select manual_result_check('wa-1', '10 Kilometres Road', $1, '28:00') c", [D]);
    expect(check.c).toMatchObject({ seconds: 1680, has_table: true, threshold: 1000, duplicate: null });
    const pts = check.c.wa_points;
    expect(Math.abs(pts - table(1680))).toBeLessThanOrEqual(1);
    await add({ mark: "28:00" });
    const w = await db.one("select source, source_url, result_score, added_by from wa_results where rider_slug = 'wa-1'");
    expect(w).toEqual({ source: "manual", source_url: "https://my.raceresult.com/123", result_score: pts, added_by: admin });
    // (WA-Punkte − 1000) × 0,1 × Disziplinfaktor
    const f = Number((await db.one("select factor from disciplines where name = '10 Kilometres Road'")).factor);
    expect(await points()).toEqual([["10 Kilometres Road", Math.round((pts - 1000) * 0.1 * f * 100) / 100]]);
    expect((await db.one("select name from races r join results x on x.race_slug = r.pcs_slug where x.rider_slug = 'wa-1'")).name).toBe("Stadtlauf");
  });

  it("lehnt Doppelte, Unsinn und Nicht-Admins ab", async () => {
    await add({ mark: "28:00" });
    await expect(add({ mark: "28:05", date: `${Y}-03-02` })).rejects.toThrow(/schon ein Ergebnis/);
    await expect(add({ mark: "DNF", discipline: "Half Marathon" })).rejects.toThrow(/Zeit nicht erkannt/);
    await expect(add({ mark: "1:02:00", discipline: "Half Marathon" })).rejects.toThrow(/von Hand angeben/);
    await add({ mark: "1:02:00", discipline: "Half Marathon", wa_points: 1180 });   // ohne Tabelle: Punkte von Hand
    await expect(add({ mark: "28:00", discipline: "Cross Country" })).rejects.toThrow(/kann nicht nachgetragen/);
    expect((await db.one("select manual_result_check('wa-1', '10 Kilometres Road', $1, '28:00') c", [D])).c.duplicate)
      .toMatchObject({ source: "manual", competition: "Stadtlauf" });
    // wie über die echte Schnittstelle: angemeldeter Nutzer ohne eigene Liga
    await as(db, await createUser(db, "bob"));
    await db.query("set session authorization authenticated");
    await expect(add({ mark: "28:00", date: `${Y}-04-01` })).rejects.toThrow(/Nur Liga-Admins/);
    await db.query("reset session authorization");
  });

  it("entfällt, sobald World Athletics dasselbe Ergebnis führt; Löschen", async () => {
    const { id } = await add({ mark: "28:00" });
    await db.query(`insert into wa_results (rider_slug, date, competition, discipline, race, wa_race, mark, result_score)
                    values ('wa-1', $1, 'Stadtlauf (WA)', '10 Kilometres Road', 'F', 'F', '28:01', 1345)`, [`${Y}-03-02`]);
    await db.query("select rebuild_results(null)");
    expect(await points()).toEqual([["10 Kilometres Road", Math.round(345 * 0.1 * Number((await db.one("select factor from disciplines where name = '10 Kilometres Road'")).factor) * 100) / 100]]);
    expect((await db.one("select count(*)::int n from results r join wa_results w on w.id = r.wa_result_id where w.source = 'manual'")).n).toBe(0);
    await db.query("select delete_manual_result($1)", [id]);
    expect((await db.one("select count(*)::int n from wa_results where source = 'manual'")).n).toBe(0);
    await expect(db.query("select delete_manual_result((select id from wa_results where rider_slug = 'wa-1'))")).rejects.toThrow(/nicht gefunden/);
  });
});
