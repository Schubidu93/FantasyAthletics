// Erkundung: persönliche Bestleistungen bei World Athletics (für PB-Bonus und PB-Liste im Profil)
// - __NEXT_DATA__ der Athletenseite (enthält die Daten samt Feldnamen)
// - Abfragen getSingleCompetitor / AllTimePersonalTop10 / SeasonBests mit vermuteten Feldern (Fehlermeldungen nennen gültige Felder)
// Ergebnis: research/out/pb/*
import { writeFileSync } from "node:fs";
import { discoverApiConfig, sleep } from "../importer/wa";

const OUT = "research/out/pb";
const UA = "Mozilla/5.0 (compatible; FantasyAthletics/2.0)";
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
process.on("exit", () => writeFileSync(`${OUT}/log.txt`, log.join("\n")));

// 1. Athletenseite (Robert Farken)
const page = await fetch("https://worldathletics.org/athletes/germany/robert-farken-14650473", { headers: { "User-Agent": UA } });
const html = await page.text();
say(`Seite: ${page.status}, ${html.length} Zeichen`);
const next = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
if (next) {
  writeFileSync(`${OUT}/next-data.json`, JSON.stringify(JSON.parse(next), null, 1));
  say(`__NEXT_DATA__ gespeichert (${next.length} Zeichen)`);
} else say("kein __NEXT_DATA__");

// 2. Abfragen
const api = await discoverApiConfig();
async function gql(name: string, query: string, variables: Record<string, unknown>) {
  await sleep(1000);
  const res = await fetch(api.url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": UA },
    body: JSON.stringify({ query, variables }) });
  const body = await res.text();
  writeFileSync(`${OUT}/${name}.json`, body);
  say(`${name}: ${res.status}, ${body.slice(0, 600)}`);
}
const id = 14650473;
await gql("pb", `query($id: Int) { getSingleCompetitor(id: $id) { personalBests { withWind results { indoor discipline mark notLegal venue date resultScore records } } } }`, { id });
await gql("pb-min", `query($id: Int) { getSingleCompetitor(id: $id) { personalBests { results { discipline mark date } } } }`, { id });
await gql("progression", `query($id: Int) { getSingleCompetitor(id: $id) { progressionOfSeasonsBests { discipline indoor results { season mark date venue resultScore } } } }`, { id });
await gql("top10", `query($id: Int, $d: String) { getSingleCompetitorAllTimePersonalTop10(id: $id, allTimePersonalTop10Discipline: $d) { results { discipline mark date venue resultScore indoor } } }`, { id, d: "10229502" });
await gql("seasonbests-2024", `query($id: Int, $s: Int) { getSingleCompetitorSeasonBests(id: $id, seasonsBestsSeason: $s) { results { discipline mark date venue resultScore indoor } } }`, { id, s: 2024 });
await gql("typename", `query($id: Int) { getSingleCompetitor(id: $id) { __typename } }`, { id });
