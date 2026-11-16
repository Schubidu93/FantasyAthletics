// Wettkampfkalender: kommende Wettkämpfe mit Laufdisziplinen aus dem öffentlichen WA-Kalender (GraphQL getCalendarEvents).
// Grenzen wie im Scriptable-Widget „Leichtathletik“:
//   Bahn:          weltweit ab Gold Label (OW, DF, GW, GL), in Europa ab A, in Deutschland ab B
//   Straße, Cross: weltweit ab Gold Label, in Europa ab A, in Deutschland ab E
// Meetings ohne Laufdisziplinen (Sprung, Wurf, Mehrkampf, Gehen, Sprint) werden am Namen erkannt und weggelassen.
// Täglich im Ablauf „Athletenpool laden“. Umgebung: SUPABASE_URL, SUPABASE_SERVICE_KEY, optional WA_API_URL/WA_API_KEY.
import { adminClient, chunked } from "./supabase";
import { discoverApiConfig, sleep, type ApiConfig } from "./wa";

const db = adminClient();
const DAYS_AHEAD = 365;
const GERMANY = { regionType: "country", regionId: 13188422 };
const EUROPE = { regionType: "area", regionId: 3 };
const WORLD = {};
const CATEGORY_IDS: Record<string, number> = { OW: 4, DF: 11, GW: 5, GL: 6, A: 1, B: 2, C: 3, D: 9, E: 7 };
const KINDS = { track: 5, road: 2, cross: 6 } as const;
type Kind = keyof typeof KINDS;
const TOP = ["OW", "DF", "GW", "GL"];
const QUERIES: Record<Kind, { region: Record<string, unknown>; categories: string[] }[]> = {
  track: [{ region: WORLD, categories: TOP }, { region: EUROPE, categories: ["A"] }, { region: GERMANY, categories: ["B"] }],
  road: [{ region: WORLD, categories: TOP }, { region: EUROPE, categories: ["A"] }, { region: GERMANY, categories: ["B", "C", "D", "E"] }],
  cross: [{ region: WORLD, categories: TOP }, { region: EUROPE, categories: ["A"] }, { region: GERMANY, categories: ["B", "C", "D", "E"] }],
};
// Wettkämpfe ohne Laufdisziplinen ab 800 m
export const NOT_RUNNING = /pole vault|jump|throw|hammer|javelin|discus|shot ?put|combined events|multi|decathlon|heptathlon|pentathlon|race ?walk|walking|sprint|stabhoch|sprung|wurf|mehrkampf|geher|kugel|speer/i;

const QUERY = `
  query getCalendarEvents($startDate: String, $endDate: String, $regionType: String, $regionId: Int, $disciplineId: Int,
                          $rankingCategoryId: Int, $limit: Int, $offset: Int) {
    getCalendarEvents(startDate: $startDate, endDate: $endDate, regionType: $regionType, regionId: $regionId,
                      disciplineId: $disciplineId, rankingCategoryId: $rankingCategoryId, limit: $limit, offset: $offset) {
      hits
      results { id name venue country rankingCategory disciplines competitionGroup startDate endDate }
    }
  }`;
type Ev = { id: number; name: string; venue: string | null; country: string | null; rankingCategory: string | null;
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

  const byId = new Map<number, Record<string, unknown> & { kinds: Set<Kind> }>();
  const skipped = new Set<string>();
  let failures = 0;
  for (const kind of Object.keys(QUERIES) as Kind[]) {
    for (const { region, categories } of QUERIES[kind]) {
      for (const cat of categories) {
        try {
          for (const e of await load(api, { startDate: from, endDate: to, disciplineId: KINDS[kind], rankingCategoryId: CATEGORY_IDS[cat], ...region })) {
            if (NOT_RUNNING.test(e.name)) { skipped.add(e.name); continue; }
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
  return `Kalender: ${rows.length} kommende Wettkämpfe (${from} bis ${to}), ${skipped.size} ohne Laufdisziplinen übersprungen` +
    (failures ? `, ${failures} Abfragen fehlgeschlagen` : "");
};

try {
  console.log(await main());
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e));
  process.exitCode = 1;
}
