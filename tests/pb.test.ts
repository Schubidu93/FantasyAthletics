// PB-Bonus: schneller als alles davor (Bestleistung vor 2025 + gespeicherte Ergebnisse), ab der Schwelle, Vorlauf und Finale je einzeln
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { athlete, freshDb, type Db } from "./db";

let db: Db;
const Y = new Date().getFullYear();
beforeEach(async () => {
  db = await freshDb();
  await athlete(db, 1, "Robert FARKEN", "men", "1500 Metres", 1240);
  await db.query("insert into athlete_pb_before (athlete_id, discipline, mark, date) values ('wa-1', '1500 Metres', '3:32.00', '2024-07-01')");
});
afterEach(async () => {
  await db.end();
});
const add = (date: string, mark: string, score: number, extra = {} as Record<string, string>) => db.query(
  `insert into wa_results (athlete_id, date, competition, discipline, race, wa_race, mark, result_score, remark)
   values ('wa-1', $1, $2, $3, 'F', $4, $5, $6, $7)`,
  [date, extra.competition ?? `Meeting ${date}`, extra.discipline ?? "1500 Metres", extra.wa_race ?? "F", mark, score, extra.remark ?? null]);
const pb = async () => (await db.all("select result_date::text d, pb_points from results where athlete_id = 'wa-1' order by result_date, id"))
  .map((r) => [r.d, Number(r.pb_points)]);

describe("PB-Bonus", () => {
  it("zählt jede Verbesserung, Vorlauf und Finale einzeln, =PB halb, nicht erste Leistung", async () => {
    await add(`${Y}-05-01`, "3:33.00", 1200);                       // keine PB
    await add(`${Y}-06-01`, "3:31.50", 1225);                       // PB
    await add(`${Y}-06-01`, "3:31.50", 1225, { competition: "Meeting B" });   // gleicher Tag: auch schneller als vorher → PB
    await add(`${Y}-07-01`, "3:31.50", 1225);                       // gleiche Zeit → =PB, halber Bonus
    await add(`${Y}-08-01`, "3:31.00", 1230, { wa_race: "H1" });    // Vorlauf PB
    await add(`${Y}-08-03`, "3:30.50", 1235);                       // Finale PB
    await add(`${Y}-08-10`, "3:29.00", 1250, { competition: "London - Split times", remark: "ST" });   // Zwischenzeit: PB-Bonus (sonst keine Punkte)
    await add(`${Y}-08-20`, "3:29.50", 1245);                       // langsamer als die Zwischenzeit → keine PB
    await add(`${Y}-09-01`, "13:10.00", 1200, { discipline: "5000 Metres" });   // erste Leistung → keine PB
    await db.query("select rebuild_results(null)");
    expect(await pb()).toEqual([[`${Y}-05-01`, 0], [`${Y}-06-01`, 10], [`${Y}-06-01`, 10], [`${Y}-07-01`, 5],
      [`${Y}-08-01`, 10], [`${Y}-08-03`, 10], [`${Y}-08-10`, 10], [`${Y}-08-20`, 0], [`${Y}-09-01`, 0]]);
  });

  it("nur ab der Schwelle; Wert einstellbar", async () => {
    await db.query("insert into athlete_pb_before (athlete_id, discipline, mark) values ('wa-1', '800 Metres', '1:50.00')");
    await add(`${Y}-05-01`, "1:49.90", 990, { discipline: "800 Metres" });   // PB, aber unter der Schwelle
    await add(`${Y}-06-01`, "3:31.00", 1230);
    await db.query(`select update_scoring_config('{"pb_points": 15}')`);
    expect(await pb()).toEqual([[`${Y}-06-01`, 15]]);
    expect(Number((await db.one("select points - perf_points - placing_points p from results where athlete_id = 'wa-1'")).p)).toBe(15);
  });
});

describe("Bestleistungen von World Athletics aufbereiten", () => {
  it("Halle als Short Track, beste Leistung vor 2025, irreguläre Leistungen ohne", async () => {
    const { bestBefore, currentPbs } = await import("../importer/pbs");
    const known = new Set(["1500 Metres", "1500 Metres Short Track", "Mile"]);
    const progression = [
      { discipline: "1500 Metres", indoor: false, results: [{ season: "2023", mark: "3:33.50", date: "01 JUL 2023" },
        { season: "2024", mark: "3:32.00", date: "07 JUL 2024" }, { season: "2025", mark: "3:30.80", date: "06 JUN 2025" }] },
      { discipline: "1500 Metres", indoor: true, results: [{ season: "2024", mark: "3:35.10", date: "10 FEB 2024" }] },
    ];
    expect(bestBefore("wa-1", progression, 2025, known)).toEqual([
      { athlete_id: "wa-1", discipline: "1500 Metres", mark: "3:32.00", date: "2024-07-07" },
      { athlete_id: "wa-1", discipline: "1500 Metres Short Track", mark: "3:35.10", date: "2024-02-10" }]);
    const pbs = currentPbs("wa-1", [
      { discipline: "Mile", mark: "3:46.82", date: "18 JUL 2026", resultScore: 1242, indoor: false },
      { discipline: "1500 Metres", mark: "3:29.00", date: "01 JUL 2026", notLegal: true },
      { discipline: "1500 Metres", mark: "3:30.09", date: "18 JUL 2026", resultScore: 1243 },
      // gleiche Hallenzeit doppelt (einmal ohne Hallen-Kennzeichen) → nur Halle
      { discipline: "3000 Metres Short Track", mark: "7:51.42", date: "28 JAN 2022", indoor: true },
      { discipline: "3000 Metres", mark: "7:51.42", date: "28 JAN 2022", indoor: false }], new Set([...known, "3000 Metres", "3000 Metres Short Track"]));
    expect(pbs.map((p) => [p.discipline, p.mark, p.date])).toEqual([["Mile", "3:46.82", "2026-07-18"], ["1500 Metres", "3:30.09", "2026-07-18"],
      ["3000 Metres Short Track", "7:51.42", "2022-01-28"]]);
  });
});
