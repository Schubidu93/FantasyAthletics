// Wettkampfkalender: kommende Wettkämpfe aus dem öffentlichen WA-Kalender (GraphQL getCalendarEvents).
// Grenzen (wie im Scriptable-Widget „Leichtathletik“, Deutschland erweitert):
//   weltweit ab Gold Label (OW, DF, GW, GL), in Europa ab A, in den Ländern aus pool_nations (Deutschland, Niederlande) ab E –
//   für Bahn, Straße und Cross (B–E: Abfrage für Europa, behalten werden nur Wettkämpfe in diesen Ländern)
// Programm („Events to be staged“) aus getCompetitionOrganiserInfo: Disziplinen für Erwachsene (keine Staffeln) und daraus die
// Bereiche (calendar_events.areas: Lauf, Sprint, Hürden, Sprung, Wurf, Mehrkampf, Gehen); ohne Programm Art und Name.
// Wettkämpfe ganz ohne Disziplinen für Erwachsene fallen weg.
// Das Programm wird je Wettkampf höchstens einmal pro Woche abgefragt.
// Täglich im Ablauf „Athletenpool laden“. Umgebung: SUPABASE_URL, SUPABASE_SERVICE_KEY, optional WA_API_URL/WA_API_KEY.
import { adminClient, chunked } from "./supabase";
import { discoverApiConfig, sleep, type ApiConfig } from "./wa";
import { calendarAreas, irrelevantChampionship, seniorEvents } from "./calendar-filter";

const db = adminClient();
const DAYS_AHEAD = 365;
const EUROPE = { regionType: "area", regionId: 3 };
const WORLD = {};
const CATEGORY_IDS: Record<string, number> = { OW: 4, DF: 11, GW: 5, GL: 6, A: 1, B: 2, C: 3, D: 9, E: 7 };
const KINDS = { track: 5, road: 2, cross: 6 } as const;
type Kind = keyof typeof KINDS;
const TOP = ["OW", "DF", "GW", "GL"];
const NATIONAL = ["B", "C", "D", "E"];   // nur in den Pool-Ländern
const QUERIES: Record<Kind, { region: Record<string, unknown>; categories: string[] }[]> = {
  track: [{ region: WORLD, categories: TOP }, { region: EUROPE, categories: ["A", "B", "C", "D", "E"] }],
  road: [{ region: WORLD, categories: TOP }, { region: EUROPE, categories: ["A", "B", "C", "D", "E"] }],
  cross: [{ region: WORLD, categories: TOP }, { region: EUROPE, categories: ["A", "B", "C", "D", "E"] }],
};


const INFO_QUERY = `query($id: Int!) { getCompetitionOrganiserInfo(competitionId: $id) { units { events gender } } }`;
async function programme(api: ApiConfig, id: number): Promise<{ gender: string; events: string[] }[] | null> {
  await sleep(600);
  const res = await fetch(api.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" },
    body: JSON.stringify({ query: INFO_QUERY, variables: { id } }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { getCompetitionOrganiserInfo?: { units?: { events?: string[]; gender?: string }[] } } };
  const units = body.data?.getCompetitionOrganiserInfo?.units;
  if (!units?.length) return null;
  return units.map((u) => ({ gender: u.gender === "Women" ? "W" : u.gender === "Men" ? "M" : String(u.gender ?? ""), events: u.events ?? [] }));
}

const QUERY = `
  query getCalendarEvents($startDate: String, $endDate: String, $regionType: String, $regionId: Int, $disciplineId: Int,
                          $rankingCategoryId: Int, $limit: Int, $offset: Int) {
    getCalendarEvents(startDate: $startDate, endDate: $endDate, regionType: $regionType, regionId: $regionId,
                      disciplineId: $disciplineId, rankingCategoryId: $rankingCategoryId, limit: $limit, offset: $offset) {
      hits
      results { id name venue area country rankingCategory disciplines competitionGroup startDate endDate }
    }
  }`;
type Ev = { id: number; name: string; venue: string | null; area: string | null; country: string | null; rankingCategory: string | null;
            disciplines: string | null; competitionGroup: string | null; startDate: string; endDate: string | null };

async function load(api: ApiConfig, vars: Record<string, unknown>): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    await sleep(600);
    const res = await fetch(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" },
      body: JSON.stringify({ operationName: "getCalendarEvents", query: QUERY, variables: { ...vars, limit: 100, offset } }),
    });
    if (!res.ok) throw new Error(`WA-Kalender ${res.status}`);
    const body = (await res.json()) as { data?: { getCalendarEvents?: { results?: Ev[] } }; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(`WA-Kalender: ${body.errors[0].message}`);
    const page = body.data?.getCalendarEvents?.results ?? [];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

// Eigener Ablauf ohne sync_status: ein Fehler im Kalender soll in der App nicht als Ergebnis-Fehler erscheinen
const main = async () => {
  const started = new Date().toISOString();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const from = iso(new Date());
  const to = iso(new Date(Date.now() + DAYS_AHEAD * 864e5));
  const api: ApiConfig = process.env.WA_API_URL && process.env.WA_API_KEY
    ? { url: process.env.WA_API_URL, key: process.env.WA_API_KEY } : await discoverApiConfig();

  const { data: nations, error: nErr } = await db.from("pool_nations").select("code");
  if (nErr) throw nErr;
  const homes = (nations as { code: string }[]).map((n) => n.code);
  const byId = new Map<number, Record<string, unknown> & { kinds: Set<Kind>; events?: unknown; events_checked_at?: string | null; areas?: string[] | null }>();
  const skipped = new Set<string>();
  let failures = 0;
  for (const kind of Object.keys(QUERIES) as Kind[]) {
    for (const { region, categories } of QUERIES[kind]) {
      for (const cat of categories) {
        try {
          for (const e of await load(api, { startDate: from, endDate: to, disciplineId: KINDS[kind], rankingCategoryId: CATEGORY_IDS[cat], ...region })) {
            if (NATIONAL.includes(cat) && !homes.includes(e.country ?? "")) continue;
            if (irrelevantChampionship(e, homes)) { skipped.add(e.name); continue; }
            const prev = byId.get(Number(e.id));
            if (prev) { prev.kinds.add(kind); continue; }
            byId.set(Number(e.id), {
              id: Number(e.id), name: e.name, venue: e.venue, country: e.country, category: e.rankingCategory,
              competition_group: e.competitionGroup, start_date: e.startDate, end_date: e.endDate || e.startDate,
              updated_at: started, kinds: new Set([kind]),
            });
          }
        } catch (err) {
          failures++;
          console.warn(`${kind} ${cat}: ${(err as Error).message}`);
        }
      }
    }
  }
  // Programm: nur für neue Wettkämpfe oder wenn die letzte Abfrage älter als 7 Tage ist (bzw. noch kein Programm da war)
  const known = new Map(((await db.from("calendar_events").select("id, events, events_checked_at, areas")).data ?? [])
    .map((r: { id: number; events: unknown; events_checked_at: string | null; areas: string[] | null }) => [Number(r.id), r]));
  let asked = 0, dropped = 0;
  for (const [id, row] of [...byId]) {
    const prev = known.get(id);
    // areas fehlt = noch aus der Zeit, als nur Laufdisziplinen gespeichert wurden → Programm neu holen
    const fresh = prev?.events_checked_at && Date.now() - Date.parse(prev.events_checked_at) < 7 * 864e5 && prev.events && prev.areas;
    let units: { gender: string; events: string[] }[] | null;
    row.events = null;
    if (fresh) { units = prev!.events as { gender: string; events: string[] }[]; row.events_checked_at = prev!.events_checked_at!; }
    else { units = await programme(api, id).catch(() => null); asked++; row.events_checked_at = started; }
    if (units) {
      const senior = units.map((u) => ({ gender: u.gender, events: seniorEvents(u.events) })).filter((u) => u.events.length);
      if (!senior.length) { byId.delete(id); dropped++; skipped.add(String(row.name)); continue; }
      row.events = senior;
    }
    row.areas = calendarAreas(row.events as { events: string[] }[] | null, [...row.kinds], String(row.name));
  }
  const rows = [...byId.values()].map((r) => ({ ...r, kinds: [...r.kinds] }));
  if (!rows.length) throw new Error(`Keine Wettkämpfe gefunden (${failures} Fehler)`);
  await chunked(rows, 500, async (chunk) => {
    const { error } = await db.from("calendar_events").upsert(chunk, { onConflict: "id" });
    if (error) throw new Error(`calendar_events: ${error.message}`);
  });
  // abgesagte/verschobene Termine und Vergangenes entfernen (nur wenn alle Abfragen geklappt haben)
  if (!failures) {
    const { error } = await db.from("calendar_events").delete().lt("updated_at", started);
    if (error) throw new Error(`calendar_events löschen: ${error.message}`);
  }
  return `Kalender: ${rows.length} kommende Wettkämpfe (${from} bis ${to}), ${skipped.size} übersprungen ` +
    `(${dropped} laut Programm ohne Erwachsene); Programm für ${asked} Wettkämpfe abgefragt` +
    (failures ? `, ${failures} Abfragen fehlgeschlagen` : "");
};

try {
  console.log(await main());
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e));
  process.exitCode = 1;
}
