// Zwischenzeiten zählen nicht; Rekord-Bonus (nur der höchste) vom Admin eingetragen
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, type Db } from "./db";

let db: Db;
let admin: string;
const Y = new Date().getFullYear();

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, "admin");
  await as(db, admin);
  await db.query("select create_league('Liga', 'Team', '{}')");
  await athlete(db, 1, "Robert FARKEN", "men", "1500 Metres", 1240);
  await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, wa_place, mark, result_score, remark) values
    ('wa-1', '${Y}-07-18', 'London Meet, London - Diamond Discipline', 'Mile', 'GW', 'F', 'F', 4, 4, '3:46.82', 1242, null),
    ('wa-1', '${Y}-07-18', 'London Meet, London - Split times', '1500 Metres', 'F', 'F', 'F', null, null, '3:30.09', 1243, 'ST'),
    ('wa-1', '${Y}-07-04', 'Prefontaine Classic, Eugene - Split times', '1500 Metres', 'F', 'F', 'F', 4, 4, '3:32.46', 1210, null)`);
  await db.query("select rebuild_results(null)");
});
afterEach(async () => {
  await db.end();
});

const pts = async () => (await db.all("select label, points, record_points from results where athlete_id = 'wa-1' order by result_date, label desc"))
  .map((r) => [r.label, Number(r.points), Number(r.record_points)]);

describe("Zwischenzeiten und Rekorde", () => {
  it("wertet Zwischenzeiten nur mit Rekord- und PB-Bonus", async () => {
    // London-Zwischenzeit 3:30.09 ist schneller als die frühere Zwischenzeit 3:32.46 → nur PB-Bonus
    const split = (await db.one("select id from wa_results where remark = 'ST'")).id;
    const pb = await db.one("select points, perf_points, placing_points, pb_points from results where wa_result_id = $1", [split]);
    expect([pb.points, pb.perf_points, pb.placing_points, pb.pb_points].map(Number)).toEqual([10, 0, 0, 10]);
    await db.query("select set_result_record($1, 'DR')", [split]);
    const r = await db.one("select points, perf_points, placing_points, record_points from results where wa_result_id = $1", [split]);
    expect([r.points, r.perf_points, r.placing_points, r.record_points].map(Number)).toEqual([60, 0, 0, 50]);
  });

  it("gibt den Bonus für den höchsten Rekord und nimmt ihn wieder weg", async () => {
    const id = (await db.one("select id from wa_results where discipline = 'Mile'")).id;
    const base = (await pts())[0][1];
    await db.query("select set_result_record($1, 'DR')", [id]);
    expect((await pts())[0]).toEqual(["Mile", base + 50, 50]);
    await db.query("select update_scoring_config('{\"record_er\": 70}')");
    await db.query("select set_result_record($1, 'ER')", [id]);
    expect((await pts())[0]).toEqual(["Mile", base + 70, 70]);
    await db.query("select set_result_record($1, null)", [id]);
    expect((await pts())[0]).toEqual(["Mile", base, 0]);
    // Importer überschreibt den Rekord nicht (Upsert ohne die Spalte)
    await db.query("select set_result_record($1, 'WR')", [id]);
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, wa_race, mark, result_score)
      values ('wa-1', '${Y}-07-18', 'London Meet, London - Diamond Discipline', 'Mile', 'F', '3:46.82', 1242)
      on conflict (athlete_id, date, discipline, wa_race, competition, not_legal) do update set mark = excluded.mark`);
    expect((await db.one("select record from wa_results where id = $1", [id])).record).toBe("WR");
  });
});

describe("Rekorde aus All-time-Listen", () => {
  it("erkennt auch inzwischen verbesserte Rekorde, aber keine schlechteren Leistungen", async () => {
    const { recordMarks } = await import("../importer/records");
    const row = (athleteId: number, mark: string, date: string) => ({ athleteId, name: `A${athleteId}`, birthDate: null, mark, date, score: 0 });
    const rows = [
      row(1, "3:29.80", `${Y}-08-20`),   // neuer Rekord
      row(2, "3:30.05", `${Y}-06-01`),   // damals Rekord, inzwischen verbessert
      row(3, "3:30.50", "2014-07-01"),   // alter Rekord
      row(4, "3:31.00", `${Y}-07-01`),   // schlechter als der alte Rekord
    ];
    expect(recordMarks(rows, "2025-01-01", "1500 Metres").map((r) => [r.athleteId, r.tied])).toEqual([[1, false], [2, false]]);
    // gleiche Zeit wie der alte Rekord → eingestellt (zählt halb)
    expect(recordMarks([row(5, "3:30.50", `${Y}-05-01`), row(3, "3:30.50", "2014-07-01")], "2025-01-01", "1500 Metres")
      .map((r) => [r.athleteId, r.tied])).toEqual([[5, true]]);
    // gleiches Rennen: nur der Schnellere hält den Rekord
    expect(recordMarks([row(1, "3:29.0", "2026-05-01"), row(2, "3:29.5", "2026-05-01"), row(3, "3:30.5", "2014-07-01")], "2025-01-01", "1500 Metres")
      .map((r) => r.athleteId)).toEqual([1]);
    // Sprung: weiter ist besser
    expect(recordMarks([row(1, "8.30", `${Y}-06-01`), row(2, "8.20", `${Y}-07-01`), row(3, "8.25", "2014-07-01")], "2025-01-01", "Long Jump")
      .map((r) => r.athleteId)).toEqual([1]);
  });

  it("Richtung der Disziplinen stimmt mit der Datenbank überein (research/disciplines.txt)", async () => {
    const { higherBetter, TOPLIST_DISCIPLINES } = await import("../importer/disciplines");
    const { readFileSync } = await import("node:fs");
    const rows = readFileSync("research/disciplines.txt", "utf8").split("\n").filter((l) => l && !l.startsWith("#"))
      .map((l) => l.split("|"));
    const names = new Set(rows.map((r) => r[0]));
    for (const [name, , , , , higher] of rows) expect([name, higherBetter(name)]).toEqual([name, higher === "1"]);
    // jede Topliste gehört zu einer bekannten Disziplin
    for (const d of TOPLIST_DISCIPLINES) expect(names.has(d.name), d.name).toBe(true);
  });

  it("kennzeichnet passende Ergebnisse, der höhere Rekord gewinnt", async () => {
    const rows = [{ athlete_id: "wa-1", discipline: "Mile", date: `${Y}-07-18`, mark: "3:46.82", record: "DR" },
                  { athlete_id: "wa-1", discipline: "Mile", date: `${Y}-07-18`, mark: "3:46.82", record: "ER" },
                  { athlete_id: "wa-9", discipline: "Mile", date: `${Y}-07-18`, mark: "3:40.00", record: "WR" }];
    expect((await db.one("select apply_records($1) n", [JSON.stringify(rows)])).n).toBe(1);
    expect((await pts())[0][2]).toBe(100);
    // ein späterer DR-Fund stuft nicht zurück
    expect((await db.one("select apply_records($1) n", [JSON.stringify([rows[0]])])).n).toBe(0);
    // eingestellter Rekord: halbe Punkte
    const id = (await db.one("select id from wa_results where discipline = 'Mile'")).id;
    await db.query("select set_result_record($1, '=WR')", [id]);
    expect((await pts())[0][2]).toBe(100);
  });
});

describe("Meisterschaft im offenen Rennen", () => {
  it("zählt der Meisterschaftsplatz (Kategorie B), wenn er mehr bringt als der Platz im Rennen", async () => {
    await athlete(db, 2, "Tom THURLEY", "men", "Marathon", 1150);
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, wa_place, mark, result_score)
      values ('wa-2', '${Y}-10-25', 'Frankfurt Marathon', 'Marathon', 'GL', 'F', 'F', 15, 15, '2:09:30', 1150)`);
    await db.query("select rebuild_results(null)");
    const plc = async () => Number((await db.one("select placing_points p from results where athlete_id = 'wa-2'")).p);
    const before = await plc();
    const id = (await db.one("select id from wa_results where athlete_id = 'wa-2'")).id;
    await db.query("select set_result_champ($1, 1)", [id]);
    const b1 = Number((await db.one(`select max(ps.points) p from placing_scores ps join disciplines d on ps.placing_table = any (d.placing_tables)
      where d.name = 'Marathon' and ps.category = 'B' and ps.race_type = 'F' and ps.place = 1`)).p);
    const f = Number((await db.one("select factor from disciplines where name = 'Marathon'")).factor);
    expect(await plc()).toBeCloseTo(Math.max(before, Math.round(b1 * 0.1 * f * 100) / 100), 2);
    expect(await plc()).toBeGreaterThan(before);
    await db.query("select set_result_champ($1, null)", [id]);
    expect(await plc()).toBe(before);
  });
});
