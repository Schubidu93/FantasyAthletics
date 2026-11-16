// Erkundung: Meisterschaft im offenen Rennen (DM im Hannover-Marathon 2026, Tom Thurley).
// Wo steht die Meisterschaftswertung („B1“)? Ergebnis: research/out/champ/*
import { mkdirSync, writeFileSync } from "node:fs";
import { discoverApiConfig, sleep } from "../importer/wa";

const OUT = "research/out/champ";
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
const id = 14682657, competitionId = 7236399, eventId = 10229634;
await gql("athlete-2026", `query($id: Int, $y: Int) { getSingleCompetitorResultsDate(id: $id, resultsByYear: $y, resultsByYearOrderBy: "date") {
  resultsByDate { date competition venue discipline country category race place mark wind notLegal resultScore remark competitionId eventId } } }`, { id, y: 2026 });
await gql("athlete-2026-min", `query($id: Int, $y: Int) { getSingleCompetitorResultsDate(id: $id, resultsByYear: $y, resultsByYearOrderBy: "date") {
  resultsByDate { date competition discipline category race place mark resultScore remark competitionId eventId } } }`, { id, y: 2026 });
await gql("event", `query($c: Int, $e: Int) { getCalendarCompetitionResults(competitionId: $c, day: null, eventId: $e) {
  eventTitles { rankingCategory eventTitle events { event eventId gender competitions { date race raceNumber
    results { competitor { id name } mark place qualified records remark nationality } } } } } }`, { c: competitionId, e: eventId });
await gql("event-min", `query($c: Int, $e: Int) { getCalendarCompetitionResults(competitionId: $c, day: null, eventId: $e) {
  eventTitles { events { eventId competitions { date race raceNumber results { competitor { id name } mark place } } } } } }`, { c: competitionId, e: eventId });
const page = await fetch(`https://worldathletics.org/competition/calendar-results/results/${competitionId}?eventId=${eventId}`, { headers: { "User-Agent": UA } });
const html = await page.text();
writeFileSync(`${OUT}/event-page.html`, html);
say(`Ergebnisseite: ${page.status}, ${html.length} Zeichen`);
const athletePage = await fetch(`https://worldathletics.org/athletes/germany/tom-thurley-${id}`, { headers: { "User-Agent": UA } });
const ah = await athletePage.text();
const next = ah.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
if (next) writeFileSync(`${OUT}/athlete-next.json`, JSON.stringify(JSON.parse(next), null, 1));
say(`Athletenseite: ${athletePage.status}, NEXT_DATA ${next ? next.length : 0}`);
