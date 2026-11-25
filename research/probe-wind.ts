// Erkundung: Leistungen mit zu viel Rückenwind (> 2,0 m/s). Wie liefert WA sie in den Athletenergebnissen
// (zwei Zeilen? notLegal? resultScore mit Windkorrektur?) und in den Event-Ergebnissen?
// Beispiel: NK 2025 Weitsprung Frauen (Pauline Hondema 6,76 +2,5 = Platz 1, gültig 6,63). Ergebnis: research/out/wind/*
import { mkdirSync, writeFileSync } from "node:fs";
import { discoverApiConfig, sleep } from "../importer/wa";

const OUT = "research/out/wind";
mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (compatible; FantasyAthletics/2.0)";
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
process.on("exit", () => writeFileSync(`${OUT}/log.txt`, log.join("\n")));
const api = await discoverApiConfig();
async function gql(name: string, query: string, variables: Record<string, unknown>) {
  await sleep(1000);
  const res = await fetch(api.url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": UA },
    body: JSON.stringify({ query, variables }) });
  const body = await res.text();
  writeFileSync(`${OUT}/${name}.json`, body);
  say(`${name}: ${res.status}, ${body.length} Zeichen, ${body.slice(0, 300)}`);
}
const competitionId = 7227988, eventId = 10229528;
for (const [name, id] of [["hondema", 14740867], ["vanderstoel", 14854025]] as const) {
  await gql(`athlete-${name}-2025`, `query($id: Int, $y: Int) { getSingleCompetitorResultsDate(id: $id, resultsByYear: $y, resultsByYearOrderBy: "date") {
    resultsByDate { date competition venue discipline country category race place mark wind notLegal resultScore remark competitionId eventId } } }`, { id, y: 2025 });
}
await gql("event", `query($c: Int, $e: Int) { getCalendarCompetitionResults(competitionId: $c, day: null, eventId: $e) {
  eventTitles { rankingCategory eventTitle events { event eventId gender perResultWind withWind competitions { date race raceNumber wind
    results { competitor { id name } mark place wind qualified records remark nationality } } } } } }`, { c: competitionId, e: eventId });
await gql("event-min", `query($c: Int, $e: Int) { getCalendarCompetitionResults(competitionId: $c, day: null, eventId: $e) {
  eventTitles { events { eventId competitions { date race raceNumber results { competitor { id name } mark place wind } } } } } }`, { c: competitionId, e: eventId });
