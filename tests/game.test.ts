import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createDb, createUser, one } from "./db";

let db: PGlite;
let alice: string, bob: string, carol: string;
let season: number;
let members: Record<string, number>;

const ATHLETES: [number, string, string, number][] = [
  // id, name, discipline, score
  [1, "A 800", "800 Metres", 1150],
  [2, "B 1500", "1500 Metres", 1200],
  [3, "C 5000", "5000 Metres", 1180],
  [4, "D 10000", "10,000 Metres", 1100],
  [5, "E Marathon", "Marathon", 1170],
  [6, "F Hindernis", "3000 Metres Steeplechase", 1120],
  [7, "G 1500", "1500 Metres", 1050],
  [8, "H 800", "800 Metres", 1010],
  [9, "I zu langsam", "1500 Metres", 950],
];

async function setup(rosterSize = 2) {
  db = await createDb();
  alice = await createUser(db, "alice");
  bob = await createUser(db, "bob");
  carol = await createUser(db, "carol");
  const year = new Date().getFullYear();
  for (const [id, name, discipline, score] of ATHLETES) {
    await db.query("insert into athletes (id, name, gender) values ($1, $2, 'M')", [id, name]);
    await db.query(
      "insert into toplist_entries (athlete_id, year, discipline, mark, score) values ($1, $2, $3, '-', $4)",
      [id, year - 1, discipline, score],
    );
  }
  await as(db, alice);
  season = (await one<{ id: number }>(db, "select create_season($1, 'Test', 'Team Alice') as id", [year]))!.id;
  await db.query("update seasons set roster_size = $2 where id = $1", [season, rosterSize]);
  const code = (await one<{ join_code: string }>(db, "select join_code from seasons where id = $1", [season]))!.join_code;
  await as(db, bob);
  await db.query("select join_season($1, 'Team Bob')", [code.toUpperCase()]);
  await as(db, carol);
  await db.query("select join_season($1, 'Team Carol')", [code]);
  const rows = (await db.query<{ id: number; team_name: string }>(
    "select id, team_name from season_members where season_id = $1", [season])).rows;
  members = Object.fromEntries(rows.map((r) => [r.team_name.replace("Team ", "").toLowerCase(), r.id]));
}

async function draftAll(order: [string, number][]) {
  for (const [user, athlete] of order) {
    await as(db, user);
    await db.query("select make_draft_pick($1, $2)", [season, athlete]);
  }
}

async function startDraft() {
  await as(db, alice);
  await db.query("select set_draft_order($1, $2)", [season, [members.alice, members.bob, members.carol]]);
  await db.query("select start_draft($1)", [season]);
}

describe("Pool", () => {
  beforeEach(() => setup());

  it("enthält nur Athleten über der Schwelle", async () => {
    const pool = (await db.query<{ athlete_id: number }>(
      "select athlete_id from season_pool where season_id = $1 order by 1", [season])).rows.map((r) => Number(r.athlete_id));
    expect(pool).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("leitet die Gruppe aus der besten Toplistenleistung ab", async () => {
    const r = await one<{ event_group: string }>(db, "select event_group from athlete_overview where id = 6");
    expect(r!.event_group).toBe("Hindernis");
  });
});

describe("Snake-Draft", () => {
  beforeEach(() => setup());

  it("läuft in Schlangenreihenfolge und endet nach roster_size Runden", async () => {
    await startDraft();
    const expected = [members.alice, members.bob, members.carol, members.carol, members.bob, members.alice];
    for (let pick = 1; pick <= 6; pick++) {
      const st = await one<{ member_id: number }>(db, "select * from draft_state($1)", [season]);
      expect(st!.member_id).toBe(expected[pick - 1]);
      const user = { [members.alice]: alice, [members.bob]: bob, [members.carol]: carol }[st!.member_id]!;
      await as(db, user);
      await db.query("select make_draft_pick($1, $2)", [season, pick]);
    }
    const s = await one<{ status: string }>(db, "select status from seasons where id = $1", [season]);
    expect(s!.status).toBe("active");
  });

  it("verhindert Picks außer der Reihe, doppelte Picks und Athleten außerhalb des Pools", async () => {
    await startDraft();
    await as(db, bob);
    await expect(db.query("select make_draft_pick($1, 1)", [season])).rejects.toThrow(/nicht am Zug/);
    await as(db, alice);
    await expect(db.query("select make_draft_pick($1, 9)", [season])).rejects.toThrow(/nicht im Pool/);
    await db.query("select make_draft_pick($1, 1)", [season]);
    await as(db, bob);
    await expect(db.query("select make_draft_pick($1, 1)", [season])).rejects.toThrow(/vergeben/);
  });
});

describe("Punkte", () => {
  beforeEach(() => setup());

  it("berechnet Leistungs- und Platzierungspunkte", async () => {
    const year = new Date().getFullYear();
    await db.query("update seasons set perf_threshold = 1000, perf_factor = 2, placing_factor = 0.5 where id = $1", [season]);
    await db.query(
      `insert into results (athlete_id, date, competition, discipline, category, race, place, result_score)
       values (2, $1, 'Meeting', '1500 Metres', 'GL', 'F', 1, 1180),
              (2, $1, 'Meeting2', '1500 Metres', 'GL', 'H1', 1, 1100),
              (5, $1, 'Marathon', 'Marathon', 'GL', 'F', 2, 1150),
              (2, $1, 'Staffel', '4x100 Metres Relay', 'GL', 'F', 1, 1200)`,
      [`${year}-05-01`],
    );
    const rows = (await db.query<{ competition: string; performance_points: string; placing_points: string; total_points: string }>(
      "select competition, performance_points, placing_points, total_points from result_points where season_id = $1 order by competition",
      [season])).rows;
    const by = Object.fromEntries(rows.map((r) => [r.competition, r]));
    // (1180-1000)*2*1 = 360, GL-Sieg 1500m = 170 * 0.5 = 85
    expect(Number(by.Meeting.performance_points)).toBe(360);
    expect(Number(by.Meeting.placing_points)).toBe(85);
    // Vorlauf: keine Platzierungspunkte
    expect(Number(by.Meeting2.placing_points)).toBe(0);
    // Marathon Faktor 3: (150*2)*3 = 900, GL Platz 2 = 105*0.5*3 = 157.5
    expect(Number(by.Marathon.total_points)).toBe(1057.5);
    // Disziplin mit Faktor 0
    expect(Number(by.Staffel.total_points)).toBe(0);
  });
});

describe("Aufstellung, Transfers, Trades", () => {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const addDays = (n: number) => iso(new Date(today.getTime() + n * 86400000));

  beforeEach(async () => {
    await setup(3);
    // Spieltag 1 läuft (gestern bis +5), Spieltag 2 in der Zukunft
    await db.query(
      "insert into matchdays (season_id, number, starts_on, ends_on) values ($1, 1, $2, $3), ($1, 2, $4, $5)",
      [season, addDays(-1), addDays(5), addDays(6), addDays(12)],
    );
    await startDraft();
    // alice: 1,6,7  bob: 2,5,8  carol: 3,4,(—)
    await draftAll([[alice, 1], [bob, 2], [carol, 3], [carol, 4], [bob, 5], [alice, 6], [alice, 7], [bob, 8]]);
    // Pool reicht nicht für die letzte Runde
    await as(db, alice);
    await db.query("select finish_draft($1)", [season]);
  });

  it("prüft Gruppen und zählt nur Ergebnisse aufgestellter Athleten", async () => {
    await as(db, alice);
    await expect(db.query("select set_lineup($1, 2, $2)", [season, { "1500": 1 }])).rejects.toThrow(/Gruppe 800/);
    await expect(db.query("select set_lineup($1, 2, $2)", [season, { "800": 2 }])).rejects.toThrow(/nicht in deinem Kader/);
    // laufender Spieltag: leere Positionen dürfen besetzt werden
    await db.query("select set_lineup($1, 1, $2)", [season, { "800": 1, "WC1": 7 }]);
    // ...danach sind sie gesperrt
    await expect(db.query("select set_lineup($1, 1, $2)", [season, { "800": 1, "WC1": 6 }])).rejects.toThrow(/gesperrt/);
    await db.query("select set_lineup($1, 1, $2)", [season, { "800": 1, "WC1": 7, "Hindernis": 6 }]);

    await db.query(
      `insert into results (athlete_id, date, competition, discipline, category, race, place, result_score)
       values (1, $1, 'X', '800 Metres', 'A', 'F', 1, 1100),
              (7, $1, 'Y', '1500 Metres', 'A', 'F', 8, 1000),
              (2, $1, 'Z', '1500 Metres', 'A', 'F', 1, 1300),
              (1, $2, 'Vorher', '800 Metres', 'A', 'F', 1, 1100)`,
      [addDays(0), addDays(-30)],
    );
    const st = (await db.query<{ team_name: string; points: string }>(
      "select team_name, points from standings where season_id = $1 order by team_name", [season])).rows;
    // alice: 800m (100 + 140) + 1500m (0 + 60) = 300; bob hat keine Aufstellung
    expect(st.map((r) => [r.team_name, Number(r.points)])).toEqual([
      ["Team Alice", 300], ["Team Bob", 0], ["Team Carol", 0],
    ]);
  });

  it("Free Agent: Kadergröße und Verfügbarkeit werden geprüft", async () => {
    await as(db, alice);
    await expect(db.query("select claim_free_agent($1, 9)", [season])).rejects.toThrow(/nicht im Pool/);
    await expect(db.query("select claim_free_agent($1, 2)", [season])).rejects.toThrow(/vergeben/);
    await as(db, carol);
    // carol hat nur 2 von 3 Plätzen belegt – da ist nichts mehr frei im Pool, außer nach Abgabe
    await db.query("select release_athlete($1, 4)", [season]);
    await as(db, alice);
    await expect(db.query("select claim_free_agent($1, 4)", [season])).rejects.toThrow(/Kader ist voll/);
    await db.query("select claim_free_agent($1, 4, 7)", [season]);
    const r = (await db.query<{ id: number }>("select id from current_rosters where member_id = $1 order by id", [members.alice])).rows;
    expect(r.map((x) => Number(x.id))).toEqual([1, 4, 6]);
  });

  it("Trade: Angebot annehmen tauscht die Athleten", async () => {
    await as(db, alice);
    const tid = (await one<{ id: number }>(db, "select propose_trade($1, $2, $3, $4) as id",
      [season, members.bob, [1], [2]]))!.id;
    await expect(db.query("select respond_trade($1, true)", [tid])).rejects.toThrow(/angefragte Team/);
    await as(db, bob);
    const res = await one<{ r: string }>(db, "select respond_trade($1, true) as r", [tid]);
    expect(res!.r).toBe("accepted");
    const owner = async (a: number) => (await one<{ member_id: number }>(db,
      "select member_id from current_rosters where id = $1", [a]))!.member_id;
    expect(await owner(1)).toBe(members.bob);
    expect(await owner(2)).toBe(members.alice);
  });

  it("Trade wird ungültig, wenn ein Athlet inzwischen weg ist", async () => {
    await as(db, alice);
    const tid = (await one<{ id: number }>(db, "select propose_trade($1, $2, $3, $4) as id",
      [season, members.bob, [7], [8]]))!.id;
    await db.query("select release_athlete($1, 7)", [season]);
    await as(db, bob);
    const res = await one<{ r: string }>(db, "select respond_trade($1, true) as r", [tid]);
    expect(res!.r).toBe("invalid");
  });
});

describe("Geteilte Finals", () => {
  beforeEach(() => setup());

  it("wertet die kombinierte Platzierung und behält die WA-Rohdaten als Schlüssel", async () => {
    const date = `${new Date().getFullYear()}-07-01`;
    const insert = (race: string, place: number) => db.query(
      `insert into results (athlete_id, date, competition, discipline, category, race, place, wa_race, wa_place, result_score)
       values (3, $1, 'Meeting', '5000 Metres', 'GL', $2, $3, 'F1', 5, 1000)
       on conflict (athlete_id, date, discipline, wa_race, competition) do update set race = excluded.race, place = excluded.place`,
      [date, race, place]);
    await insert("F1", 5); // noch nicht aufgelöst -> keine Platzierungspunkte
    const r = await one<{ placing_points: string }>(db, "select placing_points from result_points where athlete_id = 3");
    expect(Number(r!.placing_points)).toBe(0);
    await insert("F", 7); // aufgelöst: GL 5000m Platz 7 = 70, Faktor 1.3
    const rows = (await db.query<{ placing_points: string; wa_race: string; wa_place: number }>(
      "select placing_points, wa_race, wa_place from result_points where athlete_id = 3")).rows;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].placing_points)).toBe(91);
    expect([rows[0].wa_race, rows[0].wa_place]).toEqual(["F1", 5]);
  });
});

describe("Übersichten", () => {
  beforeEach(() => setup());

  it("pool_overview zeigt Besitzer und Punkte", async () => {
    await startDraft();
    await as(db, alice);
    await db.query("select make_draft_pick($1, 2)", [season]);
    await db.query(
      "insert into results (athlete_id, date, competition, discipline, category, race, place, result_score) values (2, $1, 'M', '1500 Metres', 'B', 'F', 2, 1050)",
      [`${new Date().getFullYear()}-06-01`],
    );
    const r = await one<{ owner_team: string; season_points: string; event_group: string }>(db,
      "select owner_team, season_points, event_group from pool_overview where season_id = $1 and id = 2", [season]);
    expect(r).toEqual({ owner_team: "Team Alice", season_points: "130.0", event_group: "1500" });
  });
});
