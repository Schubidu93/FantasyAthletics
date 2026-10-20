// Einmaliges Erkundungsskript (läuft in GitHub Actions, weil worldathletics.org dort erreichbar ist):
// 1. World-Ranking-Regelseiten 2026 sichern
// 2. Beispiel-Events mit Halbfinals/Vorläufen/geteilten Finals bei Großereignissen finden
// 3. deren Detailergebnisse (HTML, eingebettete Daten, GraphQL) sichern
import * as cheerio from "cheerio";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { discoverApiConfig, fetchAthleteResults, sleep, type ApiConfig, type WaResult } from "../importer/wa";

const OUT = "research/out";
mkdirSync(`${OUT}/rules`, { recursive: true });
mkdirSync(`${OUT}/events`, { recursive: true });
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" };
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };

async function get(url: string) {
  const res = await fetch(url, { headers: UA });
  return { status: res.status, text: await res.text() };
}

function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer").remove();
  const lines: string[] = [];
  $("h1, h2, h3, h4, h5, p, li, table").each((_, el) => {
    if (el.tagName === "table") {
      $(el).find("tr").each((__, tr) => {
        lines.push($(tr).find("th, td").toArray().map((c) => $(c).text().replace(/\s+/g, " ").trim()).join(" | "));
      });
      lines.push("");
    } else if (!$(el).parents("table").length) {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) lines.push(el.tagName.startsWith("h") ? `\n## ${t}` : t);
    }
  });
  return lines.join("\n");
}

// 1. Regeln -----------------------------------------------------------------
for (const slug of ["track-field-events-2026", "road-running-2026", "cross-country-2026", "overall-rankings-2026"]) {
  try {
    const { status, text } = await get(`https://worldathletics.org/world-ranking-rules/${slug}`);
    writeFileSync(`${OUT}/rules/${slug}.html`, text);
    writeFileSync(`${OUT}/rules/${slug}.txt`, pageText(text));
    const next = cheerio.load(text)("script#__NEXT_DATA__").text();
    if (next) writeFileSync(`${OUT}/rules/${slug}.next.json`, JSON.stringify(JSON.parse(next), null, 1));
    say(`rules ${slug}: ${status}, ${text.length} bytes, next=${!!next}`);
  } catch (e) {
    say(`rules ${slug}: FEHLER ${(e as Error).message}`);
  }
}

// 2. API-Konfiguration ----------------------------------------------------------
const candidates: ApiConfig[] = [];
try {
  candidates.push(await discoverApiConfig());
} catch (e) {
  say(`discover: ${(e as Error).message}`);
}
candidates.push(
  { url: "https://graphql-prod-4875.edge.aws.worldathletics.org/graphql", key: "da2-jkcja3ykujbf3cz64fs7w5gl6m" },
  { url: "https://graphql-prod-4861.edge.aws.worldathletics.org/graphql", key: "da2-wwstcy3ygvbrvmxohiq72k4szq" },
);
let api: ApiConfig | null = null;
for (const c of candidates) {
  try {
    const r = await fetchAthleteResults(c, 14914521, 2026);
    say(`api ${c.url} ${c.key.slice(0, 8)}…: ok (${r.length})`);
    api = c;
    break;
  } catch (e) {
    say(`api ${c.url} ${c.key.slice(0, 8)}…: ${(e as Error).message}`);
  }
}
writeFileSync(`${OUT}/api.json`, JSON.stringify(api, null, 1));

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(api!.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api!.key },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

if (api) {
  // Schema (falls Introspection erlaubt ist)
  const intro = await gql(`{ __schema { queryType { fields { name args { name type { name kind ofType { name } } } } } } }`);
  writeFileSync(`${OUT}/schema-query-fields.json`, JSON.stringify(intro, null, 1));
  for (const t of ["CalendarCompetitionResults", "CompetitionResults", "Race", "Result", "RaceResult", "CompetitionRace"]) {
    const r = await gql(`query($n: String!) { __type(name: $n) { name fields { name type { name kind ofType { name kind ofType { name } } } } } }`, { n: t });
    writeFileSync(`${OUT}/schema-type-${t}.json`, JSON.stringify(r, null, 1));
  }

  // 3. Beispiel-Events suchen ---------------------------------------------------------
  const ids = readFileSync("research/athlete-ids.txt", "utf8").split(/\s+/).filter(Boolean).map(Number);
  const found: (WaResult & { athleteId: number })[] = [];
  const jobs = ids.flatMap((id) => [2025, 2026].map((year) => ({ id, year })));
  async function worker() {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      try {
        const res = await fetchAthleteResults(api!, job.id, job.year);
        for (const r of res) {
          if (r.race !== "F" && r.race !== "") found.push({ ...r, athleteId: job.id });
        }
      } catch (e) {
        say(`athlete ${job.id}/${job.year}: ${(e as Error).message}`);
      }
      await sleep(250);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  writeFileSync(`${OUT}/non-final-results.json`, JSON.stringify(found, null, 1));
  say(`Nicht-Final-Ergebnisse: ${found.length}`);

  // Events auswählen: Großereignisse mit SF/H, dazu geteilte Finals
  const byEvent = new Map<string, (typeof found)[number][]>();
  for (const r of found) {
    if (!r.competitionId || !r.eventId) continue;
    const k = `${r.competitionId}-${r.eventId}`;
    byEvent.set(k, [...(byEvent.get(k) ?? []), r]);
  }
  const score = (rs: (typeof found)[number][]) => {
    const r = rs[0];
    let s = { OW: 50, DF: 30, GW: 40, GL: 20 }[r.category ?? ""] ?? 0;
    if (/^SF/.test(r.race)) s += 10;
    if (/^F\d/.test(r.race)) s += 15;
    if (/^H/.test(r.race)) s += 5;
    return s;
  };
  const picked = [...byEvent.entries()].filter(([, rs]) => score(rs) >= 20)
    .sort((a, b) => score(b[1]) - score(a[1]));
  // Vielfalt: pro (Kategorie, Renntyp, Disziplin) höchstens 1, insgesamt max. 25
  const seen = new Set<string>();
  const selection = picked.filter(([, rs]) => {
    const r = rs[0];
    const k = `${r.category}|${r.race.replace(/\d+$/, "")}|${r.discipline}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 25);
  writeFileSync(`${OUT}/selected-events.json`, JSON.stringify(selection.map(([k, rs]) => ({ key: k, results: rs })), null, 1));

  for (const [key, rs] of selection) {
    const r = rs[0];
    const url = `https://worldathletics.org/competition/calendar-results/results/${r.competitionId}?eventId=${r.eventId}`;
    try {
      const { status, text } = await get(url);
      writeFileSync(`${OUT}/events/${key}.html`, text);
      const next = cheerio.load(text)("script#__NEXT_DATA__").text();
      if (next) writeFileSync(`${OUT}/events/${key}.next.json`, JSON.stringify(JSON.parse(next), null, 1));
      const g = await gql(`query($competitionId: Int, $eventId: Int) {
        getCalendarCompetitionResults(competitionId: $competitionId, eventId: $eventId) {
          eventTitles { eventTitle events { event eventId races { date day race raceId raceNumber
            results { competitor { id name } mark nationality place points qualified records remark } } } } } }`,
        { competitionId: r.competitionId, eventId: r.eventId });
      writeFileSync(`${OUT}/events/${key}.gql.json`, JSON.stringify(g, null, 1));
      say(`event ${key} ${r.category} ${r.discipline} ${r.race} ${r.competition}: html ${status} ${text.length}b next=${!!next} gql=${g.status}`);
    } catch (e) {
      say(`event ${key}: ${(e as Error).message}`);
    }
    await sleep(500);
  }
}

writeFileSync(`${OUT}/log.txt`, log.join("\n") + "\n");
