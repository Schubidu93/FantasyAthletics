// Testdatenbank für den Oberflächentest: Schema + Referenzdaten + erfundene Athleten, Ergebnisse,
// eine laufende Mixed-Liga (je Disziplin m + w) mit drei Teams.
//   ADMIN_URL=postgres://…/postgres DB=fa_ui npx tsx tests/ui/seed.ts   → gibt die Nutzer-ID von „alice“ aus
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const ROOT = join(import.meta.dirname, "..", "..");
const ADMIN_URL = process.env.ADMIN_URL ?? "postgres://postgres@localhost:54329/postgres?host=/tmp/fa-pg";
const DB = process.env.DB ?? "fa_ui";
const Y = new Date().getFullYear();
const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const a = new pg.Client({ connectionString: ADMIN_URL });
await a.connect();
await a.query(`drop database if exists ${DB} with (force)`);
await a.query(`create database ${DB}`);
await a.end();
const u = new URL(ADMIN_URL);
u.pathname = `/${DB}`;
const db = new pg.Client({ connectionString: u.toString() });
await db.connect();
await db.query("set client_min_messages = warning");
for (const f of ["tests/supabase-stub.sql", "supabase/schema.sql", "supabase/reference_data.sql"]) {
  await db.query(readFileSync(join(ROOT, f), "utf8"));
}

// Erfundene Athleten: [Name, Geschlecht, Toplisten-Disziplin, Bestleistung, WA-Punkte]
const ATHLETES: [string, "men" | "women", string, string, number][] = [
  ["Jonas WEBER", "men", "800 Metres", "1:45.20", 1180], ["Lena KRAUSE", "women", "800 Metres", "2:00.10", 1170],
  ["Felix BRAUN", "men", "800 Metres", "1:46.40", 1130], ["Mia HOFMANN", "women", "800 Metres Short Track", "2:01.90", 1120],
  ["Paul SCHULZ", "men", "1500 Metres", "3:34.10", 1210], ["Hanna KOCH", "women", "1500 Metres", "4:02.30", 1200],
  ["Tim RICHTER", "men", "Mile", "3:55.00", 1150], ["Sophie WOLF", "women", "1500 Metres", "4:07.80", 1140],
  ["Lukas BECKER", "men", "5000 Metres", "13:12.40", 1190], ["Emma SCHRÖDER", "women", "5000 Metres", "15:02.10", 1180],
  ["Max NEUMANN", "men", "3000 Metres", "7:48.90", 1120], ["Clara SCHWARZ", "women", "3000 Metres Short Track", "8:52.00", 1100],
  ["Niklas ZIMMER", "men", "10,000 Metres", "27:55.10", 1160], ["Anna KRÜGER", "women", "10 Kilometres Road", "31:40", 1150],
  ["David HARTMANN", "men", "10 Kilometres Road", "28:30", 1110], ["Laura LANGE", "women", "10,000 Metres", "32:10.00", 1120],
  ["Simon SCHMITT", "men", "Marathon", "2:09:15", 1180], ["Julia WERNER", "women", "Marathon", "2:24:30", 1190],
  ["Moritz KRAUS", "men", "Half Marathon", "1:01:40", 1140], ["Marie MEIER", "women", "Half Marathon", "1:09:50", 1130],
  ["Leon LEHMANN", "men", "3000 Metres Steeplechase", "8:15.30", 1170], ["Lea SCHMID", "women", "3000 Metres Steeplechase", "9:20.10", 1160],
  ["Ben SCHULZE", "men", "3000 Metres Steeplechase", "8:24.00", 1120], ["Nele MAIER", "women", "2000 Metres Steeplechase", "6:20.00", 1080],
  ["Elias KÖHLER", "men", "1500 Metres", "3:38.00", 1100], ["Ida HERRMANN", "women", "800 Metres", "2:02.50", 1090],
  ["Noah KÖNIG", "men", "5000 Metres", "13:30.00", 1100], ["Pia WALTER", "women", "Marathon", "2:28:00", 1110],
];

let id = 14800000;
const slugs: string[] = [];
for (const [name, gender, disc, mark, score] of ATHLETES) {
  const slug = `wa-${++id}`;
  slugs.push(slug);
  await db.query("insert into riders (pcs_slug, wa_id, name, gender, nation, birth_date) values ($1, $2, $3, $4, 'GER', $5)",
    [slug, id, name, gender, `${1994 + (id % 9)}-0${1 + (id % 9)}-1${id % 9}`]);
  await db.query("insert into toplist_entries (rider_slug, year, discipline, mark, score) values ($1, $2, $3, $4, $5)", [slug, Y - 1, disc, mark, score]);
}
await db.query("select refresh_pool($1)", [Y]);

// Ergebnisse dieses Jahres (Wettkämpfe mit Kategorien) – teils Halbfinals mit Q/q, ein geteiltes Finale
const comps: [number, string, string, string, number][] = [
  [7300001, "Deutsche Hallenmeisterschaften, Dortmund", "B", "GER", -250],
  [7300002, "World Athletics Indoor Championships, Toruń", "GW", "POL", -230],
  [7300003, "Diamond League, Rom", "GW", "ITA", -40],
  [7300004, "Europameisterschaften, Birmingham", "GL", "GBR", -20],
  [7300005, "Berlin-Marathon", "GW", "GER", -5],
];
const res = async (slug: string, ci: number, disc: string, race: string, place: number, mark: string, score: number,
  extra: { pr?: string; pp?: number; wr?: string; wp?: number } = {}) => {
  const [cid, name, cat, country, off] = comps[ci];
  await db.query(
    `insert into wa_results (rider_slug, date, competition, venue, discipline, country, category, race, place, wa_race, wa_place,
                             placing_round, placing_place, mark, result_score, wa_competition_id, wa_event_id)
     values ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 1)`,
    [slug, day(off), name, disc, country, cat, race, place, extra.wr ?? race, extra.wp ?? place, extra.pr ?? null, extra.pp ?? null,
     mark, score, cid]);
};
await res(slugs[0], 0, "800 Metres Short Track", "F", 1, "1:46.90", 1150);
await res(slugs[1], 1, "800 Metres Short Track", "SF1", 2, "2:01.10", 1160, { pr: "P9", pp: 0 });
await res(slugs[4], 2, "1500 Metres", "F", 4, "3:33.80", 1215);
await res(slugs[5], 2, "1500 Metres", "F", 6, "4:01.90", 1205);
await res(slugs[8], 3, "5000 Metres", "F", 2, "13:15.00", 1185);
await res(slugs[9], 3, "5000 Metres", "F", 5, "15:05.30", 1175);
await res(slugs[20], 3, "3000 Metres Steeplechase", "H1", 3, "8:20.10", 1150, { pr: "P10", pp: 0 });
await res(slugs[12], 3, "10,000 Metres", "F", 7, "28:01.00", 1150, { wr: "F2", wp: 3 });
await res(slugs[16], 4, "Marathon", "F", 9, "2:08:40", 1190);
await res(slugs[17], 4, "Marathon", "F", 6, "2:23:50", 1195);
for (const [cid, name, cat, country, off] of comps) {
  await db.query("insert into races (pcs_slug, name, venue, country, uci_class, start_date, end_date) values ($1, $2, $2, $3, $4, $5, $5)",
    [`wa-c${cid}`, name, country, cat, day(off)]);
}
await db.query("select rebuild_results(null)");
await db.query("select refresh_season_stats($1)", [Y]);
await db.query("update sync_status set last_run = now(), ok = true");

// Nutzer und Liga
const users: Record<string, string> = {};
for (const n of ["alice", "bob", "carol"]) {
  users[n] = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [users[n], `${n}@example.com`]);
}
const as = (u: string) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [u]);
await as(users.alice);
const league = (await db.query("select create_league($1, 'Spikes & Splits', $2) id",
  [`Runner Fantasy ${Y}`, { gender: "mixed", lineup_mode: "mf", roster_size: 16, wildcards: 2, draft_mode: "snake",
    season_start: `${Y}-01-01`, season_end: `${Y}-12-31` }])).rows[0].id;
const code = (await db.query("select invite_code from leagues where id = $1", [league])).rows[0].invite_code;
await as(users.bob);
await db.query("select join_league($1, 'Tartan Toreros')", [code]);
await as(users.carol);
await db.query("select join_league($1, 'Hindernis-Hasen')", [code]);
const mgr = Object.fromEntries((await db.query("select id, team_name from managers where league_id = $1", [league])).rows.map((r) => [r.team_name, r.id]));
const rosters: Record<string, number[]> = {
  "Spikes & Splits": [0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24],
  "Tartan Toreros": [2, 3, 6, 7, 10, 11, 14, 15, 18],
  "Hindernis-Hasen": [19, 22, 23, 25, 26, 27],
};
let pos = 0;
for (const [team, idx] of Object.entries(rosters)) {
  await db.query("update managers set draft_position = $2 where id = $1", [mgr[team], ++pos]);
  for (const i of idx) {
    await db.query("insert into roster_entries (league_id, manager_id, rider_slug, price, source, acquired_on) values ($1, $2, $3, 0, 'draft', $4)",
      [league, mgr[team], slugs[i], `${Y}-01-01`]);
  }
}
await db.query("update leagues set status = 'active' where id = $1", [league]);
await db.query("update draft_state set status = 'done' where league_id = $1", [league]);
await as(users.alice);
const md = async (name: string, s: number, e: number) =>
  (await db.query("select upsert_matchday($1, null, $2, $3, $4) id", [league, name, day(s), day(e)])).rows[0].id;
// Spieltage in der Vergangenheit direkt anlegen (upsert_matchday sperrt nur laufende Fristen nicht)
for (const [name, s, e] of [["Hallensaison", -260, -200], ["Frühjahr", -199, -60], ["Sommer", -59, -2]] as [string, number, number][]) {
  await db.query(`insert into matchdays (league_id, name, starts_on, ends_on, deadline, status, waivers_done, locked)
                  values ($1, $2, $3, $4, $3::date - 1, 'running', true, true)`, [league, name, day(s), day(e)]);
}
await md("Herbst", 3, 30);
await db.query("update matchdays set status = 'running' where league_id = $1 and starts_on <= current_date", [league]);
await db.end();
console.log(users.alice);
