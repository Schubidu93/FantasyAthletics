import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, type Db } from "./db";

let db: Db;
const Y = new Date().getFullYear();
const D = `${Y}-06-01`;

beforeEach(async () => {
  db = await freshDb();
  // Die meisten Tests rechnen mit Faktor 1 (leichter nachvollziehbar); Standard ist 0,1 – siehe eigener Test
  await db.query("update scoring_config set perf_factor = 1, placing_factor = 1, cross_factor = 1");
});
afterEach(async () => {
  await db.end();
});

describe("Standardwerte wie im alten Spiel (Faktor 0,1)", () => {
  it("Ergebnisse von Filimon Abraham", async () => {
    await db.query("update scoring_config set perf_factor = default, placing_factor = default, cross_factor = default");
    const a = await athlete(db, 1, "Filimon ABRAHAM", "men", "Marathon", 1150);
    await result(a, "15 Kilometres Road", "F", "F", 24, 1019, { competition: "a 15 km Nijmegen" });
    await result(a, "Marathon", "F", "F", 9, 1135, { competition: "b Marathon Frankfurt" });
    await result(a, "10 Kilometres Road", "B", "F", 2, 1077, { competition: "c 10 km DM Siegburg" });
    await result(a, "10 Kilometres Road", "F", "F", 2, 1086, { competition: "d 10 km Berlin" });
    await result(a, "Cross Country", "GL", "F", 1, 0, { competition: "e Cross Pforzheim - XC 7.5km" });
    await db.query("select rebuild_results(null)");
    expect(await points()).toEqual({
      "a 15 km Nijmegen": [3.04, 0],        // altes Spiel: 3,04
      "b Marathon Frankfurt": [40.5, 0],    // altes Spiel: 40,50
      "c 10 km DM Siegburg": [12.32, 4],    // WA 2026: Road Running B 2. = 25 (altes Spiel: 50 → 20,32)
      "d 10 km Berlin": [13.76, 0.32],      // WA 2026: Road Running F 2. = 2 (altes Spiel: 14,40)
      "e Cross Pforzheim - XC 7.5km": [32, 0], // (1200 − 1000) × 0,1 × 1,6 – wie im alten Spiel
    });
  });
});

async function result(slug: string, discipline: string, category: string, race: string, place: number | null, score: number,
  extra: { competition?: string; placing_round?: string; placing_place?: number } = {}) {
  await db.query(
    `insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, wa_place, result_score,
                             wa_competition_id, placing_round, placing_place)
     values ($1, $2, $3, $4, $5, $6, $6, $7, $7, $8, 7000000 + (random() * 1000)::int, $9, $10)`,
    [slug, D, extra.competition ?? `${discipline} ${race}`, discipline, category, race, place, score,
     extra.placing_round ?? null, extra.placing_place ?? null],
  );
}

const points = async () => Object.fromEntries((await db.all(
  `select w.competition, r.perf_points, r.placing_points, r.points
     from wa_results w left join results r on r.wa_result_id = w.id order by 1`))
  .map((r) => [r.competition, r.points === null ? null : [Number(r.perf_points), Number(r.placing_points)]]));

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
      "g Cross GL 3.": [264, 0],                   // Tab. 6.1 GL 3. = 1165 → (1165 − 1000) × 1 × 1,6, keine Platzierungspunkte
      "h Berglauf GL 2.": [0, 43.2],               // Tab. 2.10 GL 2. = 27 × 1,6
      "i Staffel": null,                           // Faktor 0
      "j geteiltes Finale unaufgelöst": null,      // F1 ohne kombinierte Platzierung
      "k Vorlauf ohne Wertung": null,
    });
  });

  it("Cross: Distanzfaktor aus dem Wettkampfnamen (z. B. Pforzheim 1,5 km und 7,5 km)", async () => {
    const a = await athlete(db, 1, "Läufer A", "men", "10,000 Metres", 1200);
    const b = await athlete(db, 2, "Läuferin B", "women", "1500 Metres", 1200);
    const c = await athlete(db, 3, "Läufer C", "men", "Marathon", 1200);
    // gleiche Wettkampf-ID, zwei Rennen – getrennt gewertet
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, result_score, wa_competition_id)
      values ($1, $4, 'Sparkassen Cross Pforzheim, Pforzheim - XC 7.5km', 'Cross Country', 'GL', 'F', 'F', 1, 0, 7400001),
             ($2, $4, 'Sparkassen Cross Pforzheim, Pforzheim - XC 1.5km', 'Cross Country', 'GL', 'F', 'F', 1, 0, 7400001),
             ($1, $4, 'Sparkassen Cross Pforzheim, Pforzheim - XC 1.5km', 'Cross Country', 'GL', 'F', 'F', 3, 0, 7400001),
             ($3, $4, 'TCS Lidingoloppet, Lidingö - XC 30.0km', 'Cross Country', 'GL', 'F', 'F', 12, 0, 7400002),
             ($3, $4, 'Cross ohne Angabe', 'Cross Country', 'GL', 'F', 'F', 3, 0, 7400003),
             ($2, $4, 'Kurzer Cross - XC 4,2 km', 'Cross Country', 'B', 'F', 'F', 1, 0, 7400004)`, [a, b, c, D]);
    await db.query("select rebuild_results(null)");
    const rows = await db.all(`select r.athlete_id, r.label, r.perf_points, r.placing_points from results r order by r.athlete_id, r.label`);
    // Wertung: max(0, Cross-Tabellenwert − 1000) × Cross-Faktor (1) × Distanzfaktor
    expect(rows.map((r) => [r.athlete_id, r.label, Number(r.perf_points), Number(r.placing_points)])).toEqual([
      ["wa-1", "Cross Country · 1.5km", 165, 0],   // GL 3. = 1165 → 165 × 1
      ["wa-1", "Cross Country · 7.5km", 320, 0],   // GL 1. = 1200 → 200 × 1,6
      ["wa-2", "Cross Country · 1.5km", 200, 0],   // GL 1. = 1200 → 200 × 1
      ["wa-2", "Cross Country · 4.2km", 65, 0],    // B 1. = 1050 → 50 × 1,3
      ["wa-3", "Cross Country", 264, 0],           // ohne Distanz: GL 3. = 1165 → 165 × 1,6
      ["wa-3", "Cross Country · 30.0km", 140, 0],  // GL 12. = 1070 → 70 × 2
    ]);
    // unter 1000 gibt es nichts (B 20. = 770)
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, result_score, wa_competition_id)
      values ($1, $2, 'Hinten - XC 8km', 'Cross Country', 'B', 'F', 'F', 20, 0, 7400005)`, [a, D]);
    await db.query("select rebuild_results(null)");
    expect(await db.one("select count(*)::int n from results where label = 'Cross Country · 8km'")).toEqual({ n: 0 });
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
    const rows = await db.all("select id, pool_rank, event_group, ranking_points from athletes order by id");
    expect(rows.map((r) => [r.id, r.pool_rank, r.event_group, Number(r.ranking_points) || null])).toEqual([
      ["wa-1", 1, "1500", 1200],     // beste Leistung bestimmt die Gruppe
      ["wa-2", 2, "Hindernis", 1150],
      ["wa-3", null, "800", 990],    // unter der Schwelle: nicht im Pool
      ["wa-4", null, null, null],
    ]);
  });
});
