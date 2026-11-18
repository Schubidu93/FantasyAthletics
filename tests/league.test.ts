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
    // wa-1: 100 + A-Sieg 100; wa-6 (Wildcard): A 2. Tab. 2.5 = 63 × 1,3 = 81,9; wa-3 nicht aufgestellt
    expect(t.map((r) => [r.team_name, Number(r.total)])).toEqual([["Team Alice", 281.9], ["Team Bob", 0]]);

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
    expect(await total(lauf.id)).toBe(170);   // 100 + 50 + 20
    expect(await total(all.id)).toBe(170);
  });
});
