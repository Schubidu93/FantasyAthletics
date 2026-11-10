import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, type Db } from "./db";

let db: Db;
const Y = new Date().getFullYear();
const D = `${Y}-06-01`;

beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.end();
});

async function result(slug: string, discipline: string, category: string, race: string, place: number | null, score: number,
  extra: { competition?: string; placing_round?: string; placing_place?: number } = {}) {
  await db.query(
    `insert into wa_results (rider_slug, date, competition, discipline, category, race, wa_race, place, wa_place, result_score,
                             wa_competition_id, placing_round, placing_place)
     values ($1, $2, $3, $4, $5, $6, $6, $7, $7, $8, 7000000 + (random() * 1000)::int, $9, $10)`,
    [slug, D, extra.competition ?? `${discipline} ${race}`, discipline, category, race, place, score,
     extra.placing_round ?? null, extra.placing_place ?? null],
  );
}

const points = async () => Object.fromEntries((await db.all(
  `select w.competition, r.perf_points, r.placing_points, r.uci_points
     from wa_results w left join results r on r.wa_result_id = w.id order by 1`))
  .map((r) => [r.competition, r.uci_points === null ? null : [Number(r.perf_points), Number(r.placing_points)]]));

describe("Punkte nach WA-Regeln 2026", () => {
  it("berechnet Leistung, Platzierung, Vorrunden, Cross, Straße und Berglauf", async () => {
    const a = await athlete(db, 1, "Läufer A", "men", "1500 Metres", 1200);
    await result(a, "1500 Metres", "GL", "F", 1, 1180, { competition: "a GL-Sieg 1500" });
    await result(a, "800 Metres", "OW", "SF1", 2, 1150, { competition: "b WM-Halbfinale Q", placing_round: "P9", placing_place: 0 });
    await result(a, "800 Metres", "OW", "SF2", 5, 1000, { competition: "c WM-Halbfinale raus", placing_round: "P9", placing_place: 10 });
    await result(a, "5000 Metres", "OW", "H1", 3, 1100, { competition: "d WM-Vorlauf 5000 Q", placing_round: "P10", placing_place: 0 });
    await result(a, "Marathon", "GL", "F", 2, 1150, { competition: "e Marathon GL 2." });
    await result(a, "Half Marathon", "GW", "F", 1, 1000, { competition: "f Halbmarathon GW-Sieg" });
    await result(a, "Cross Country", "GL", "F", 3, 1200, { competition: "g Cross GL 3." });
    await result(a, "Mountain Classic", "GL", "F", 2, 1000, { competition: "h Berglauf GL 2." });
    await result(a, "4x100 Metres Relay", "GL", "F", 1, 1300, { competition: "i Staffel" });
    await result(a, "5000 Metres", "GL", "F1", 5, 1000, { competition: "j geteiltes Finale unaufgelöst" });
    await result(a, "1500 Metres", "A", "H2", 1, 1000, { competition: "k Vorlauf ohne Wertung" });
    await db.query("select rebuild_results(null)");

    expect(await points()).toEqual({
      "a GL-Sieg 1500": [180, 120],                // (1180−1000) + Tab. 2.2 GL 1.
      "b WM-Halbfinale Q": [150, 100],             // Tab. 2.3 Q/q
      "c WM-Halbfinale raus": [0, 84],             // Tab. 2.3 10.
      "d WM-Vorlauf 5000 Q": [130, 72.8],          // Faktor 1,3; Tab. 2.6 Q/q 56
      "e Marathon GL 2.": [450, 225],              // Faktor 3; Tab. 4.1 GL 2. = 75
      "f Halbmarathon GW-Sieg": [0, 200],          // max(Tab. 4.2: 32, Tab. 4.3: 100) × 2
      "g Cross GL 3.": [0, 186.4],                 // Tab. 6.1 GL 3. = 1165 × 0,1 × 1,6, keine Leistungspunkte
      "h Berglauf GL 2.": [0, 43.2],               // Tab. 2.10 GL 2. = 27 × 1,6
      "i Staffel": null,                           // Faktor 0
      "j geteiltes Finale unaufgelöst": null,      // F1 ohne kombinierte Platzierung
      "k Vorlauf ohne Wertung": null,
    });
  });

  it("Wertungsparameter ändern rechnet alle Punkte neu (nur Liga-Admins)", async () => {
    const a = await athlete(db, 1, "Läufer A", "men", "1500 Metres", 1200);
    await result(a, "1500 Metres", "GL", "F", 1, 1180, { competition: "x" });
    await db.query("select rebuild_results(null)");
    const user = await createUser(db, "admin");
    await as(db, user);
    await db.query("select create_league('Liga', 'Team', '{}')");
    await db.query("select update_scoring_config($1)", [{ perf_factor: 2, placing_factor: 0.5 }]);
    expect(await points()).toEqual({ x: [360, 60] });
  });
});

describe("Athletenpool", () => {
  it("bildet Rang und Gruppe aus den Toplisten der letzten zwei Jahre", async () => {
    await athlete(db, 1, "Schnell", "men", "1500 Metres", 1200);
    await athlete(db, 2, "Hindernis", "women", "3000 Metres Steeplechase", 1150);
    await athlete(db, 3, "Zu langsam", "men", "800 Metres", 990);
    await athlete(db, 4, "Alt", "men", "5000 Metres", 1300, Y - 2);   // Toplisteneintrag 3 Jahre zurück
    await db.query("insert into toplist_entries values ('wa-1', $1, '800 Metres', '-', 1100)", [Y]);
    await db.query("select refresh_pool(null)");
    const rows = await db.all("select pcs_slug, uci_rank, event_group, ranking_points from riders order by pcs_slug");
    expect(rows.map((r) => [r.pcs_slug, r.uci_rank, r.event_group, Number(r.ranking_points) || null])).toEqual([
      ["wa-1", 1, "1500", 1200],     // beste Leistung bestimmt die Gruppe
      ["wa-2", 2, "Hindernis", 1150],
      ["wa-3", null, "800", 990],    // unter der Schwelle: nicht im Pool
      ["wa-4", null, null, null],
    ]);
  });
});
