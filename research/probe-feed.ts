// Erkundung: resultsByAthlete (neueste Ergebnisse mehrerer Athleten in einer Abfrage)
// - wie viele Athleten pro Abfrage, wie weit zurück, Grenzen von limit
// Ergebnis: research/out/calendar/feed-*.json und feed-log.txt
import { readFileSync, writeFileSync } from "node:fs";
import { discoverApiConfig, fetchAthleteResults, sleep } from "../importer/wa";

const OUT = "research/out/calendar";
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
process.on("exit", () => writeFileSync(`${OUT}/feed-log.txt`, log.join("\n")));

const api = await discoverApiConfig();
const Q = `query($ids: [String], $limit: Int) { resultsByAthlete(athleteIds: $ids, limit: $limit) {
  results { athlete { id name } competition date discipline mark place race venue matchType } parameters { limit } } }`;
async function feed(ids: number[], limit: number) {
  await sleep(800);
  const res = await fetch(api.url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": api.key },
    body: JSON.stringify({ query: Q, variables: { ids: ids.map(String), limit } }) });
  const body = await res.json() as any;
  return { status: res.status, errors: body.errors, results: (body.data?.resultsByAthlete?.results ?? []) as any[] };
}
const span = (rs: any[]) => {
  const ds = rs.map((r) => Date.parse(r.date)).filter(Number.isFinite).sort();
  return ds.length ? `${new Date(ds[0]).toISOString().slice(0, 10)} bis ${new Date(ds.at(-1)!).toISOString().slice(0, 10)}` : "-";
};

const all = readFileSync("research/athlete-ids.txt", "utf8").split(/\s+/).filter(Boolean).map(Number);
say(`${all.length} Athleten`);

// 1. Alle in einer Abfrage, verschiedene limits
for (const limit of [50, 500, 5000]) {
  const r = await feed(all, limit);
  say(`alle ${all.length}, limit ${limit}: Status ${r.status}, ${r.results.length} Ergebnisse, ${new Set(r.results.map((x) => x.athlete?.id)).size} Athleten, ` +
    `Zeitraum ${span(r.results)}, Fehler ${JSON.stringify(r.errors ?? null).slice(0, 300)}`);
  writeFileSync(`${OUT}/feed-all-${limit}.json`, JSON.stringify(r, null, 1));
}

// 2. Blöcke zu 25, 50, 100: gleiche Treffer wie alle auf einmal?
for (const size of [25, 50, 100, 200]) {
  const seen = new Set<string>();
  let n = 0;
  for (let i = 0; i < all.length; i += size) {
    const r = await feed(all.slice(i, i + size), 1000);
    n++;
    for (const x of r.results) seen.add(`${x.athlete?.id}|${x.date}|${x.discipline}|${x.mark}`);
    if (r.errors) say(`Block ${size} ab ${i}: Fehler ${JSON.stringify(r.errors).slice(0, 200)}`);
  }
  say(`Blöcke zu ${size}: ${n} Abfragen, ${seen.size} verschiedene Ergebnisse`);
}

// 3. Vergleich mit dem Einzelabruf: welche Ergebnisse der letzten 6 Wochen fehlen im Sammelabruf?
const r = await feed(all, 5000);
const inFeed = new Set(r.results.map((x) => `${x.athlete?.id}|${x.date}`));
const cutoff = Date.now() - 42 * 864e5;
const year = new Date().getFullYear();
let checked = 0;
const missing: string[] = [];
const present: string[] = [];
for (const id of all.slice(0, 120)) {
  await sleep(400);
  const rs = await fetchAthleteResults(api, id, year).catch(() => []);
  checked++;
  for (const x of rs) {
    const d = Date.parse(x.date);
    if (d < cutoff) continue;
    const waDate = new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
    const k = `${id}|${waDate}`;
    (inFeed.has(k) ? present : missing).push(`${k} ${x.competition} ${x.discipline} ${x.mark}`);
  }
}
say(`Einzelabruf ${checked} Athleten, Ergebnisse der letzten 6 Wochen: ${present.length} im Sammelabruf, ${missing.length} fehlen`);
say(`im Sammelabruf: ${present.slice(0, 30).join("; ")}`);
say(`fehlen: ${missing.slice(0, 30).join("; ")}`);
