// Erkundung: Namenssuche (searchCompetitors) und Stammdaten (getSingleCompetitor.basicData) für „Athlet hinzufügen“.
// Ergebnis: research/out/search/*
import { mkdirSync, writeFileSync } from "node:fs";
import { discoverApiConfig, sleep } from "../importer/wa";

const OUT = "research/out/search";
mkdirSync(OUT, { recursive: true });
const api = await discoverApiConfig();
const log: string[] = [];
async function gql(name: string, query: string, variables: Record<string, unknown>) {
  await sleep(1000);
  const res = await fetch(api.url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": api.key,
    "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" }, body: JSON.stringify({ query, variables }) });
  const body = await res.text();
  writeFileSync(`${OUT}/${name}.json`, body);
  log.push(`${name}: ${res.status} ${body.slice(0, 500)}`);
}
await gql("search-full", `query($q: String, $g: GenderType) { searchCompetitors(query: $q, gender: $g) { aaAthleteId givenName familyName gender country birthDate } }`, { q: "Thurley", g: "men" });
await gql("search-nogender", `query($q: String) { searchCompetitors(query: $q) { aaAthleteId givenName familyName gender country birthDate } }`, { q: "Tom Thurley" });
await gql("search-min", `query($q: String) { searchCompetitors(query: $q) { aaAthleteId familyName givenName } }`, { q: "Thurley" });
await gql("basic", `query($id: Int) { getSingleCompetitor(id: $id) { basicData { givenName familyName countryCode birthDate } } }`, { id: 14682657 });
writeFileSync(`${OUT}/log.txt`, log.join("\n"));
console.log(log.join("\n"));
