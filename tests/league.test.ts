import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as, athlete, createUser, freshDb, type Db } from "./db";

let db: Db;
let alice: string, bob: string;
const Y = new Date().getFullYear();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (n: number) => iso(new Date(Date.now() + n * 864e5));

beforeEach(async () => {
  db = await freshDb();
  await db.query("update scoring_config set perf_factor = 1, placing_factor = 1, cross_factor = 1");   // Zahlen leichter nachvollziehbar
  alice = await createUser(db, "alice");
  bob = await createUser(db, "bob");
});
afterEach(async () => {
  await db.end();
});

async function league(settings: Record<string, unknown>) {
  await as(db, alice);
  const id = (await db.one("select create_league('Liga', 'Team Alice', $1) id", [settings])).id;
  const code = (await db.one("select invite_code from leagues where id = $1", [id])).invite_code;
  await as(db, bob);
  await db.query("select join_league($1, 'Team Bob')", [code]);
  await as(db, alice);
  const m = await db.all("select id, team_name from managers where league_id = $1", [id]);
  return { id, alice: m.find((x) => x.team_name === "Team Alice").id, bob: m.find((x) => x.team_name === "Team Bob").id };
}

describe("Liga-Einstellungen", () => {
  it("Positionen je Wertungsmodus", async () => {
    const free = await league({ gender: "men" });
    expect(await db.one("select league_slots($1) s, lineup_size, lineup_mode from leagues where id = $1", [free.id])).toEqual({
      s: ["800", "1500", "5000", "10000", "Marathon", "Hindernis", "WC1", "WC2"], lineup_size: 8, lineup_mode: "free",
    });
    // je Disziplin m + w braucht einen größeren Kader
    await expect(db.query("select create_league('X', 'T', $1)", [{ gender: "mixed", lineup_mode: "mf" }]))
      .rejects.toThrow(/mindestens so groß sein wie die Aufstellung \(14 Positionen\)/);
    const mf = await league({ gender: "mixed", lineup_mode: "mf", roster_size: 16, wildcards: 2 });
    expect((await db.one("select league_slots($1) s", [mf.id])).s).toEqual([
      "800:M", "800:W", "1500:M", "1500:W", "5000:M", "5000:W", "10000:M", "10000:W",
      "Marathon:M", "Marathon:W", "Hindernis:M", "Hindernis:W", "WC1", "WC2",
    ]);
    // "je Disziplin m + w" gibt es nur bei Mixed
    const men = await league({ gender: "men", lineup_mode: "mf" });
    expect((await db.one("select lineup_mode from leagues where id = $1", [men.id])).lineup_mode).toBe("free");
  });
});

describe("Aufstellung und Wertung", () => {
  let L: Awaited<ReturnType<typeof league>>;
  let md: string;

  beforeEach(async () => {
    // Pool: Männer und Frauen in verschiedenen Gruppen
    await athlete(db, 1, "M 800", "men", "800 Metres", 1150);
    await athlete(db, 2, "W 800", "women", "800 Metres", 1140);
    await athlete(db, 3, "M 1500", "men", "1500 Metres", 1200);
    await athlete(db, 4, "W 1500", "women", "1500 Metres", 1190);
    await athlete(db, 5, "M Marathon", "men", "Marathon", 1100);
    await athlete(db, 6, "W 5000", "women", "5000 Metres", 1120);
    await athlete(db, 7, "M 5000", "men", "5000 Metres", 1110);
    await athlete(db, 8, "W Hindernis", "women", "3000 Metres Steeplechase", 1105);
    await db.query("select refresh_pool(null)");
    L = await league({ gender: "mixed", lineup_mode: "mf", roster_size: 14, wildcards: 2, draft_mode: "offline" });
    const rows = [
      ...["wa-1", "wa-2", "wa-3", "wa-6"].map((r) => ({ manager_id: L.alice, athlete_id: r, price: 10 })),
      ...["wa-4", "wa-5", "wa-7", "wa-8"].map((r) => ({ manager_id: L.bob, athlete_id: r, price: 10 })),
    ];
    // Offline-Import verlangt volle Kader – für den Test die Kadergröße kurz absenken geht nicht (Aufstellung 14),
    // daher Kader direkt eintragen
    for (const r of rows) {
      await db.query("insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on) values ($1, $2, $3, $4, 'offline', $5)",
        [L.id, r.manager_id, r.athlete_id, r.price, `${Y}-01-01`]);
    }
    await db.query("update leagues set status = 'active' where id = $1", [L.id]);
    md = (await db.one("select upsert_matchday($1, null, 'Spieltag 1', $2, $3) id", [L.id, day(2), day(20)])).id;
  });

  it("automatische Aufstellung besetzt passende Positionen", async () => {
    const rows = await db.all("select slot, athlete_id from effective_lineup_slots($1, $2) order by slot", [md, L.alice]);
    expect(rows).toEqual([
      { slot: "1500:M", athlete_id: "wa-3" },
      { slot: "5000:W", athlete_id: "wa-6" },
      { slot: "800:M", athlete_id: "wa-1" },
      { slot: "800:W", athlete_id: "wa-2" },
    ]);
  });

  it("prüft Gruppe, Geschlecht und Kader", async () => {
    await expect(db.query("select set_lineup($1, $2)", [md, { "1500:M": "wa-1" }])).rejects.toThrow(/passt nicht auf die Position 1500:M/);
    await expect(db.query("select set_lineup($1, $2)", [md, { "800:W": "wa-1" }])).rejects.toThrow(/passt nicht/);
    await expect(db.query("select set_lineup($1, $2)", [md, { "800:M": "wa-7" }])).rejects.toThrow(/aus deinem Kader/);
    await expect(db.query("select set_lineup($1, $2)", [md, { "800:M": "wa-1", WC1: "wa-1" }])).rejects.toThrow(/nur einmal/);
    await expect(db.query("select set_lineup($1, $2)", [md, { "400:M": "wa-1" }])).rejects.toThrow(/Unbekannte Position/);
    await db.query("select set_lineup($1, $2)", [md, { "800:M": "wa-1", WC1: "wa-6", "5000:W": null }]);
    expect(await db.all("select slot, athlete_id from effective_lineup_slots($1, $2) order by slot", [md, L.alice]))
      .toEqual([{ slot: "800:M", athlete_id: "wa-1" }, { slot: "WC1", athlete_id: "wa-6" }]);
  });

  it("nur Aufgestellte punkten; Wechsel rückt nur nach, wenn die Position passt", async () => {
    await db.query("select set_lineup($1, $2)", [md, { "800:M": "wa-1", "800:W": "wa-2", WC1: "wa-6" }]);
    // Spieltag läuft
    await db.query("update matchdays set starts_on = $2, deadline = now() - interval '1 hour' where id = $1", [md, day(-1)]);
    await db.query("update roster_entries set acquired_on = $2 where league_id = $1", [L.id, day(-30)]);
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, result_score, wa_competition_id)
                    values ('wa-1', $1, 'M', '800 Metres', 'A', 'F', 'F', 1, 1100, 1),
                           ('wa-3', $1, 'M', '1500 Metres', 'A', 'F', 'F', 1, 1200, 1),
                           ('wa-6', $1, 'M', '5000 Metres', 'A', 'F', 'F', 2, 1000, 1)`, [day(0)]);
    await db.query("select rebuild_results(null)");
    const t = await db.all("select team_name, total from league_table($1) order by team_name", [L.id]);
    // wa-1: 100 + A-Sieg 100; wa-6 (Wildcard): A 2. Tab. 2.5 = 63 × 1,5 = 94,5; wa-3 nicht aufgestellt
    expect(t.map((r) => [r.team_name, Number(r.total)])).toEqual([["Team Alice", 294.5], ["Team Bob", 0]]);

    await db.query("select _lineup_swap($1, $2, 'wa-2', 'wa-4', $3)", [L.id, L.alice, day(-1)]);   // W 1500 passt nicht auf 800:W
    await db.query("select _lineup_swap($1, $2, 'wa-6', 'wa-8', $3)", [L.id, L.alice, day(-1)]);   // Wildcard nimmt jeden
    expect(await db.all("select slot, athlete_id from lineups where manager_id = $1 order by slot", [L.alice]))
      .toEqual([{ slot: "800:M", athlete_id: "wa-1" }, { slot: "WC1", athlete_id: "wa-8" }]);
  });

  it("Push „Neue Punkte“: einmal je neuem Ergebnis, nur für Aufgestellte", async () => {
    await db.query("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ('e1', $1, 'k', 'a')", [alice]);
    await db.query("select set_lineup($1, $2)", [md, { "800:M": "wa-1" }]);
    await db.query("update matchdays set starts_on = $2, deadline = now() - interval '1 hour' where id = $1", [md, day(-1)]);
    await db.query("update roster_entries set acquired_on = $2 where league_id = $1", [L.id, day(-30)]);
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, result_score, wa_competition_id)
                    values ('wa-1', $1, 'Meeting', '800 Metres', 'A', 'F', 'F', 1, 1100, 1),
                           ('wa-3', $1, 'Meeting', '1500 Metres', 'A', 'F', 'F', 1, 1200, 1)`, [day(0)]);
    await db.query("select rebuild_results(null)");
    expect((await db.one("select notify_new_points() n")).n).toBe(1);
    const msg = await db.all("select title, body, url from notifications where user_id = $1", [alice]);
    expect(msg).toHaveLength(1);
    expect(msg[0].title).toBe("📈 Neue Punkte");
    expect(msg[0].body).toMatch(/^Liga: M 800 \+200,00/);   // wa-3 nicht aufgestellt → keine Meldung
    expect(msg[0].url).toMatch(/\/points$/);
    expect((await db.one("select notify_new_points() n")).n).toBe(0);   // nicht doppelt
  });
});

describe("Draft", () => {
  it("Snake-Draft in Mixed-Liga wählt automatisch den Besten beider Geschlechter", async () => {
    await athlete(db, 1, "M", "men", "800 Metres", 1150);
    await athlete(db, 2, "W", "women", "1500 Metres", 1250);
    await db.query("select refresh_pool(null)");
    const L = await league({ gender: "mixed", draft_mode: "snake", roster_size: 8, bid_seconds: 5 });
    await db.query("select start_draft($1)", [L.id]);
    await db.query("update draft_state set deadline = now() - interval '1 second' where league_id = $1", [L.id]);
    await db.query("select draft_tick($1)", [L.id]);
    expect((await db.one("select athlete_id from draft_lots where league_id = $1 and lot_no = 1", [L.id])).athlete_id).toBe("wa-2");
  });

  it("Männerliga bietet keine Frauen an", async () => {
    await athlete(db, 1, "M", "men", "800 Metres", 1150);
    await athlete(db, 2, "W", "women", "1500 Metres", 1250);
    await db.query("select refresh_pool(null)");
    const L = await league({ gender: "men", draft_mode: "snake", roster_size: 8, bid_seconds: 5 });
    await db.query("select start_draft($1)", [L.id]);
    const st = await db.one("select nominator from draft_state where league_id = $1", [L.id]);
    await as(db, st.nominator === L.alice ? alice : bob);
    await expect(db.query("select draft_snake_pick($1, 'wa-2')", [L.id])).rejects.toThrow(/nicht verfügbar/);
    await db.query("select draft_snake_pick($1, 'wa-1')", [L.id]);
  });
});

describe("Land der Liga", () => {
  it("Niederländer nur in niederländischen Ligen, Athleten anderer Länder fliegen aus dem Pool", async () => {
    await athlete(db, 1, "Deutscher", "men", "800 Metres", 1150);
    await athlete(db, 2, "Niederländer", "men", "800 Metres", 1160);
    await athlete(db, 3, "Belgier", "men", "800 Metres", 1170);
    await db.query("update athletes set nation = 'NED' where id = 'wa-2'");
    await db.query("update athletes set nation = 'BEL' where id = 'wa-3'");
    await db.query("select refresh_pool(null)");
    expect((await db.all("select id from athletes where pool_rank is not null order by id")).map((r) => r.id)).toEqual(["wa-1", "wa-2"]);
    const de = await league({});
    const nl = await league({ nation: "NED" });
    const ok = (l: string, a: string) => db.one("select _eligible(l, a) ok from leagues l, athletes a where l.id = $1 and a.id = $2", [l, a]).then((r) => r.ok);
    expect([await ok(de.id, "wa-1"), await ok(de.id, "wa-2")]).toEqual([true, false]);
    expect([await ok(nl.id, "wa-1"), await ok(nl.id, "wa-2")]).toEqual([false, true]);
    // auch von Hand hinzugefügte zählen nur in ihrem Land
    await db.query("update athletes set manual = true where id = 'wa-2'");
    expect([await ok(de.id, "wa-2"), await ok(nl.id, "wa-2")]).toEqual([false, true]);
    await db.query("update athletes set manual = false where id = 'wa-2'");
    // Land ist nach dem Anlegen fest
    await db.query("select update_league_settings($1, '{\"nation\": \"GER\"}')", [nl.id]);
    expect((await db.one("select nation from leagues where id = $1", [nl.id])).nation).toBe("NED");
    expect((await db.all("select athlete_id from toplist($1, '800 Metres', 'men', 20, 'NED')", [new Date().getFullYear() - 1])).map((r) => r.athlete_id)).toEqual(["wa-2"]);
    // Ergebnisse und Wettkämpfe nur aus dem Land der Liga
    for (const [id, comp] of [["wa-1", 7400001], ["wa-2", 7400002]] as const) {
      await db.query("insert into wa_results (athlete_id, date, competition, discipline, mark, result_score, wa_competition_id) values ($1, current_date - 3, 'M', '800 Metres', '1:46.00', 1150, $2)", [id, comp]);
    }
    await db.query("select refresh_competition_index()");   // läuft sonst mit jeder Pool-Berechnung
    expect((await db.all("select competition_id from competition_disciplines('NED')")).map((r) => r.competition_id)).toEqual(["wa-c7400002"]);
    await db.query("insert into competitions (id, name, start_date, end_date) values ('wa-c7400001', 'M', current_date - 3, current_date - 3)");
    expect(await db.all("select athlete_id from competition_results('wa-c7400001', 'NED')")).toEqual([]);
    expect((await db.all("select athlete_id from competition_results('wa-c7400001', 'GER')")).map((r) => r.athlete_id)).toEqual(["wa-1"]);
  });
});

describe("Pool-Rang", () => {
  it("folgt den Punkten im Bezugsjahr, sobald Punkte neu berechnet werden (z. B. nach einem Rekord)", async () => {
    await athlete(db, 1, "Vorn", "men", "800 Metres", 1150);
    await athlete(db, 2, "Hinten", "men", "800 Metres", 1140);
    await db.query("select refresh_pool(null)");
    const ranks = async () => (await db.all("select id from athletes where pool_rank is not null order by pool_rank")).map((r) => r.id);
    expect(await ranks()).toEqual(["wa-1", "wa-2"]);
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, mark, result_score, wa_competition_id)
                    values ('wa-2', make_date(game_year() - 1, 7, 1), 'M', '800 Metres', 'A', 'F', 'F', 1, '1:44.00', 1200, 1)`);
    await db.query("select rebuild_results(null)");   // ohne eigenen refresh_pool
    expect(await ranks()).toEqual(["wa-2", "wa-1"]);
  });
});

describe("Rückenwind", () => {
  it("windunterstützte und gültige Leistung derselben Runde zählen als ein Ergebnis", async () => {
    await athlete(db, 1, "Springerin", "women", "Long Jump", 1100);
    await db.query("insert into athlete_pb_before (athlete_id, discipline, mark) values ('wa-1', 'Long Jump', '6.50')");
    // wie bei WA (NK 2025): 6,76 bei +2,5 mit Platz 1 (WA-Punkte schon windkorrigiert) und die beste gültige Weite 6,63 ohne Platz
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, wa_place, mark, wind,
                      not_legal, result_score, wa_competition_id)
                    values ('wa-1', '2025-08-03', 'NK', 'Long Jump', 'B', 'F', 'F', 1, 1, '6.76', '+2.5', true, 1150, 7),
                           ('wa-1', '2025-08-03', 'NK', 'Long Jump', 'B', 'F', 'F', null, null, '6.63', '+1.7', false, 1136, 7)`);
    await db.query("select rebuild_results(null)");
    const r = await db.all(`select r.rank, r.perf_points::float perf, r.placing_points::float plc, r.pb_points::float pb, w.mark
                              from results r join wa_results w on w.id = r.wa_result_id where r.athlete_id = 'wa-1'`);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ rank: 1, mark: "6.76", perf: (1150 - 1000) * 1.3 });   // besserer WA-Wert, Faktor Weitsprung 1,3
    expect(r[0].plc).toBeGreaterThan(0);                                                // Platz 1 zählt
    expect(r[0].pb).toBeGreaterThan(0);                                                 // PB aus der gültigen 6,63
    // nur Rückenwind: kein PB, keine beste Leistung der letzten 12 Monate
    await db.query("delete from wa_results where not_legal = false");
    await db.query("update wa_results set date = current_date - 10");
    await db.query("select rebuild_results(null)");
    expect(Number((await db.one("select pb_points from results where athlete_id = 'wa-1'")).pb_points)).toBe(0);
    expect((await db.one("select recent_mark from athletes where id = 'wa-1'")).recent_mark).toBeNull();
  });
});

describe("Wettkämpfe ohne Ergebnisse", () => {
  it("verschwinden beim Aufräumen, solche mit Ergebnissen bleiben", async () => {
    await athlete(db, 1, "M", "men", "800 Metres", 1150);
    await db.query("insert into wa_results (athlete_id, date, competition, discipline, mark, result_score, wa_competition_id) values ('wa-1', current_date, 'Mit', '800 Metres', '1:46.00', 1150, 7300001)");
    await db.query("insert into competitions (id, name, start_date, end_date) values ('wa-c7300001', 'Mit', current_date, current_date), ('wa-c7300002', 'Leer', current_date, current_date)");
    await db.query("select prune_athletes(true)");
    expect((await db.all("select id from competitions where id like 'wa-c73%' order by id")).map((r) => r.id)).toEqual(["wa-c7300001"]);
  });
});

describe("Beste Leistung der letzten 12 Monate", () => {
  it("nimmt die beste WA-Leistung im Jahreszeitraum, ohne Staffel und ältere Ergebnisse", async () => {
    await athlete(db, 1, "M", "men", "800 Metres", 1150);
    const add = (days: number, disc: string, mark: string, score: number) => db.query(
      "insert into wa_results (athlete_id, date, competition, discipline, mark, result_score) values ('wa-1', current_date - $1::int, 'Test ' || $1, $2, $3, $4)",
      [days, disc, mark, score]);
    await add(10, "800 Metres", "1:46.00", 1150);
    await add(400, "800 Metres", "1:44.00", 1250);           // älter als 12 Monate
    await add(20, "4x400 Metres Relay", "3:01.00", 1300);    // Staffel zählt nicht
    await db.query("select refresh_pool(null)");
    const a = await db.one("select recent_discipline, recent_mark, recent_score from athletes where id = 'wa-1'");
    expect(a).toEqual({ recent_discipline: "800 Metres", recent_mark: "1:46.00", recent_score: 1150 });
  });
});

describe("Bereiche (alle Disziplinen oder nur Lauf)", () => {
  const ALL = ["Lauf", "Sprint", "Hürden", "Sprung", "Wurf", "Mehrkampf", "Gehen"];

  beforeEach(async () => {
    await athlete(db, 1, "Läufer 800", "men", "800 Metres", 1150);
    await athlete(db, 2, "Sprinter", "men", "100 Metres", 1160);
    await athlete(db, 3, "Springer", "men", "Long Jump", 1140);
    await athlete(db, 4, "Geher", "men", "20 Kilometres Race Walk", 1130);
    await athlete(db, 5, "Hindernis", "men", "3000 Metres Steeplechase", 1120);
    await db.query("select refresh_pool(null)");
  });

  it("Gruppen der neuen Disziplinen; Mittel/Lang fassen Laufgruppen zusammen", async () => {
    expect(await db.all("select id, event_group from athletes order by id")).toEqual([
      { id: "wa-1", event_group: "800" }, { id: "wa-2", event_group: "100" }, { id: "wa-3", event_group: "Weitsprung" },
      { id: "wa-4", event_group: "Gehen" }, { id: "wa-5", event_group: "Hindernis" },
    ]);
    const ok = async (slot: string, id: string) => (await db.one("select _slot_ok($1, $2) ok", [slot, id])).ok;
    expect(await ok("Mittel", "wa-1")).toBe(true);
    expect(await ok("Lang", "wa-5")).toBe(true);
    expect(await ok("Lang", "wa-1")).toBe(false);
    expect(await ok("Sprung", "wa-3")).toBe(true);        // Block: alle Sprungdisziplinen
    expect(await ok("Weitsprung", "wa-3")).toBe(true);
    expect(await ok("Hochsprung", "wa-3")).toBe(false);
    expect(await ok("Sprint", "wa-3")).toBe(false);
    expect(await ok("Sprint", "wa-2")).toBe(true);
    expect(await ok("100", "wa-2")).toBe(true);
  });

  it("Einstellungen: Positionen müssen zu den Bereichen passen", async () => {
    await as(db, alice);
    const id = (await db.one("select create_league('A', 'T', '{}') id")).id;
    expect((await db.one("select areas from leagues where id = $1", [id])).areas).toEqual(["Lauf"]);
    await expect(db.query("select create_league('X', 'T', $1)", [{ lineup_groups: ["800", "Sprint"] }]))
      .rejects.toThrow(/Bereich der Liga/);
    await expect(db.query("select create_league('X', 'T', $1)", [{ areas: [] }])).rejects.toThrow(/mindestens einen Bereich/);
    await expect(db.query("select create_league('X', 'T', $1)", [{ areas: ["Schwimmen"] }])).rejects.toThrow(/Unbekannter Bereich/);
    const all = await league({ gender: "men", areas: ALL, roster_size: 12,
      lineup_groups: ["Sprint", "Hürden", "Mittel", "Lang", "Marathon", "Sprung", "Wurf", "Mehrkampf"] });
    expect((await db.one("select lineup_size from leagues where id = $1", [all.id])).lineup_size).toBe(10);
    // Sprungliga: je Sprungdisziplin eine Position; Laufpositionen passen nicht
    const jump = await league({ gender: "men", areas: ["Sprung"], lineup_groups: ["Hochsprung", "Stabhochsprung", "Weitsprung", "Dreisprung"] });
    expect((await db.one("select league_slots($1) s", [jump.id])).s).toEqual(["Hochsprung", "Stabhochsprung", "Weitsprung", "Dreisprung", "WC1", "WC2"]);
    await expect(db.query("select create_league('X', 'T', $1)", [{ areas: ["Sprung"], lineup_groups: ["800"] }])).rejects.toThrow(/Bereich der Liga/);
  });

  it("nur Athleten aus den Bereichen der Liga sind frei", async () => {
    const lauf = await league({ gender: "men" });
    const all = await league({ gender: "men", areas: ALL, roster_size: 12,
      lineup_groups: ["Sprint", "Mittel", "Lang", "Sprung"] });
    const free = async (l: string, id: string) => (await db.one("select _athlete_free($1, $2, now()) f", [l, id])).f;
    expect([await free(lauf.id, "wa-1"), await free(lauf.id, "wa-2"), await free(lauf.id, "wa-4")]).toEqual([true, false, false]);
    expect([await free(all.id, "wa-1"), await free(all.id, "wa-2"), await free(all.id, "wa-4")]).toEqual([true, true, true]);
  });

  it("von Athleten der Liga zählen alle Ergebnisse (auch 400 m und Gehen eines Läufers in der Laufliga)", async () => {
    const lauf = await league({ gender: "men", scoring_mode: "full", draft_mode: "offline" });
    const all = await league({ gender: "men", scoring_mode: "full", draft_mode: "offline", areas: ALL });
    for (const L of [lauf, all]) {
      await db.query("insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on) values ($1, $2, 'wa-1', 1, 'offline', $3)",
        [L.id, L.alice, day(-30)]);
      await db.query("update leagues set status = 'active' where id = $1", [L.id]);
      const md = (await db.one("select upsert_matchday($1, null, 'S', $2, $3) id", [L.id, day(2), day(20)])).id;
      await db.query("update matchdays set starts_on = $2, deadline = now() - interval '1 hour' where id = $1", [md, day(-1)]);
    }
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, result_score, wa_competition_id)
                    values ('wa-1', $1, 'M', '800 Metres', 'F', 'F', 'F', 9, 1100, 1),
                           ('wa-1', $1, 'M', '400 Metres', 'F', 'F', 'F', 9, 1050, 1),
                           ('wa-1', $1, 'M', '20 Kilometres Race Walk', 'F', 'F', 'F', 9, 1020, 1)`, [day(0)]);
    await db.query("select rebuild_results(null)");
    const total = async (l: string) => Number((await db.one("select total from league_table($1) where team_name = 'Team Alice'", [l])).total);
    expect(await total(lauf.id)).toBe(200);   // 800 m 100 + 400 m 50 + 20 km Gehen 20 × 2,5
    expect(await total(all.id)).toBe(200);
  });

  it("Draft-Report: Prognose aus dem Vorjahr nur mit Leistungs- und Platzierungspunkten (ohne PB- und Rekord-Bonus)", async () => {
    const L = await league({ gender: "men", scoring_mode: "full", draft_mode: "offline" });
    await db.query("insert into draft_lots (league_id, lot_no, athlete_id, manager_id) values ($1, 1, 'wa-1', $2)", [L.id, L.alice]);
    const prev = (await db.one("select extract(year from season_start)::int - 1 y from leagues where id = $1", [L.id])).y;
    await db.query("insert into athlete_pb_before (athlete_id, discipline, mark) values ('wa-1', '800 Metres', '1:50.00')");
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, mark, result_score, wa_competition_id)
                    values ('wa-1', $1, 'M', '800 Metres', 'F', 'F', 'F', 9, '1:45.00', 1100, 1)`, [`${prev}-06-01`]);
    await db.query("select rebuild_results(null)");
    expect(Number((await db.one("select points from results")).points)).toBe(110);   // 100 Leistung + 10 PB
    expect(Number((await db.one("select points from athlete_projection_points('men', $1)", [prev])).points)).toBe(100);
    expect(Number((await db.one("select points from draft_projection($1) where manager_id = $2", [L.id, L.alice])).points)).toBe(100);
  });

  it("Top-Leistungen je Team: nur Ergebnisse, die dem Team Punkte gebracht haben", async () => {
    const L = await league({ gender: "men", scoring_mode: "full", draft_mode: "offline" });
    // wa-1 bei Alice erst ab gestern: das Ergebnis von vor 3 Tagen zählt nicht für sie
    await db.query("insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on) values ($1, $2, 'wa-1', 1, 'offline', $3)",
      [L.id, L.alice, day(-1)]);
    await db.query("update leagues set status = 'active' where id = $1", [L.id]);
    const md = (await db.one("select upsert_matchday($1, null, 'S', $2, $3) id", [L.id, day(2), day(20)])).id;
    await db.query("update matchdays set starts_on = $2, deadline = now() - interval '1 hour' where id = $1", [md, day(-5)]);
    await db.query(`insert into wa_results (athlete_id, date, competition, discipline, category, race, wa_race, place, result_score, wa_competition_id)
                    values ('wa-1', $1, 'Heute', '800 Metres', 'F', 'F', 'F', 9, 1100, 1), ('wa-1', $2, 'Früher', '800 Metres', 'F', 'F', 'F', 9, 1150, 2),
                           ('wa-2', $1, 'Heute', '800 Metres', 'F', 'F', 'F', 9, 1200, 1)`, [day(0), day(-3)]);
    await db.query("select rebuild_results(null)");
    const top = async (m: string | null) => (await db.all("select athlete_id, points::float p from top_results('men', $1, $2, null, 100, $3, $4)",
      [day(-10), day(0), L.id, m])).map((r) => `${r.athlete_id} ${r.p}`);
    expect(await top(null)).toEqual(["wa-2 200", "wa-1 150", "wa-1 100"]);
    expect(await top(L.alice)).toEqual(["wa-1 100"]);
    expect(await top(L.bob)).toEqual([]);
  });
});
