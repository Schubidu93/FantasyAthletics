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

const pts = async () => (await db.all("select label, points, record_points from results where athlete_id = 'wa-1' order by result_date"))
  .map((r) => [r.label, Number(r.points), Number(r.record_points)]);

describe("Zwischenzeiten und Rekorde", () => {
  it("wertet Zwischenzeiten nicht", async () => {
    const rows = await pts();
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe("Mile");
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
      on conflict (athlete_id, date, discipline, wa_race, competition) do update set mark = excluded.mark`);
    expect((await db.one("select record from wa_results where id = $1", [id])).record).toBe("WR");
  });
});
