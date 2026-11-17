// Athlet hinzufügen: Auftrag (nur Admins), Pool-Aufnahme ohne Toplisteneintrag, WA-ID aus Eingabe
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, type Db } from "./db";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
  await as(db, await createUser(db, "admin"));
  await db.query("select create_league('Liga', 'Team', '{}')");
});
afterEach(async () => { await db.end(); });

describe("Athlet hinzufügen", () => {
  it("liest die WA-ID aus Zahl oder Profil-Link", async () => {
    const { idFromQuery } = await import("../importer/add-athlete-id");
    expect(idFromQuery("14682657")).toBe(14682657);
    expect(idFromQuery("https://worldathletics.org/athletes/germany/tom-thurley-14682657")).toBe(14682657);
    expect(idFromQuery("Tom Thurley")).toBeNull();
  });

  it("legt einen Auftrag an und nimmt von Hand hinzugefügte Athleten in den Pool", async () => {
    const id = (await db.one("select request_athlete('Tom Thurley') id")).id;
    expect((await db.one("select status, gender from athlete_requests where id = $1", [id]))).toEqual({ status: "offen", gender: null });
    await expect(db.query("select request_athlete('', 'men')")).rejects.toThrow(/WA-ID/);
    // unter der Grenze, kein Toplisteneintrag – aber von Hand hinzugefügt
    await athlete(db, 1, "Pool Athlet", "men", "Marathon", 1100);
    await db.query("insert into athletes (id, name, gender, nation, wa_id, manual) values ('wa-2', 'Neu Athlet', 'men', 'GER', 2, true)");
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, race, wa_race, place, wa_place, mark, result_score)
      values ('wa-2', current_date - 30, 'Stadtlauf', 'Marathon', 'F', 'F', 1, 1, '2:20:00', 900)`);
    await db.query("select refresh_pool(null)");
    const rows = await db.all("select id, pool_rank, ranking_points, event_group from athletes order by pool_rank");
    expect(rows.map((r) => [r.id, r.pool_rank])).toEqual([["wa-1", 1], ["wa-2", 2]]);
    expect([Number(rows[1].ranking_points), rows[1].event_group]).toEqual([900, "Marathon"]);
  });
});
