// Erkundung für den neuen Ergebnisabruf (läuft in GitHub Actions, weil worldathletics.org dort erreichbar ist):
// - Aufbau von Kalender, Wettkampfergebnissen und Mehr-Athleten-Abfragen (per Introspektion)
// - Kalender der letzten 14 Tage: Filter Land / Kategorie / Art, nur Wettkämpfe mit Ergebnissen
// - Wettkampfergebnisse: enthalten sie WA-Punkte (resultScore) und Athleten-IDs?
// - resultsByAthlete / getSingleCompetitorResultsByLimit mit mehreren Athleten
// Ergebnis: research/out/calendar/*.json und log.txt
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { discoverApiConfig, sleep, type ApiConfig } from "../importer/wa";

const OUT = "research/out/calendar";
mkdirSync(OUT, { recursive: true });
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
process.on("exit", () => writeFileSync(`${OUT}/log.txt`, log.join("\n")));
process.on("uncaughtException", (e) => { say(`ABBRUCH: ${e.stack}`); process.exit(1); });
const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 1));

let api: ApiConfig;
async function gql(query: string, variables: Record<string, unknown> = {}) {
  await sleep(700);
  const res = await fetch(api.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api.key },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text.slice(0, 2000) }; }
}

// --- Introspektion -------------------------------------------------------------------------
type TRef = { name: string | null; kind: string; ofType: TRef | null };
const TYPE_REF = "name kind ofType { name kind ofType { name kind ofType { name kind } } }";
const typeCache = new Map<string, any>();
async function typeInfo(name: string) {
  if (!typeCache.has(name)) {
    const r = await gql(`query($n: String!) { __type(name: $n) { name kind fields { name args { name type { ${TYPE_REF} } } type { ${TYPE_REF} } }
      inputFields { name type { ${TYPE_REF} } } enumValues { name } } }`, { n: name });
    typeCache.set(name, r.body?.data?.__type ?? null);
  }
  return typeCache.get(name);
}
const base = (t: TRef): TRef => (t.ofType ? base(t.ofType) : t);
const sig = (t: TRef): string => t.kind === "NON_NULL" ? `${sig(t.ofType!)}!` : t.kind === "LIST" ? `[${sig(t.ofType!)}]` : t.name!;

/** Auswahl aller Felder bis Tiefe `depth` (Felder mit Pflicht-Argumenten werden ausgelassen). */
async function selection(typeName: string, depth: number, seen: string[] = []): Promise<string> {
  const t = await typeInfo(typeName);
  if (!t?.fields) return "";
  const parts: string[] = [];
  for (const f of t.fields) {
    if (f.args?.some((a: any) => a.type.kind === "NON_NULL")) continue;
    const b = base(f.type);
    if (b.kind === "SCALAR" || b.kind === "ENUM") parts.push(f.name);
    else if (depth > 0 && !seen.includes(b.name!)) {
      const sub = await selection(b.name!, depth - 1, [...seen, b.name!]);
      if (sub) parts.push(`${f.name} { ${sub} }`);
    }
  }
  return parts.join(" ");
}

const schema = await (async () => {
  api = await discoverApiConfig();
  say(`API: ${api.url}`);
  const r = await gql(`{ __schema { queryType { fields { name args { name type { ${TYPE_REF} } } type { ${TYPE_REF} } } } } }`);
  return r.body?.data?.__schema?.queryType?.fields as any[];
})();

const FIELDS = ["getCalendarEvents", "getCalendarCompetitionResults", "resultsByAthlete", "getSingleCompetitorResultsByLimit",
  "competitionsByCountry", "getAthleteResults", "getResultInfo", "getSingleCompetitorResultsDate"];
const field = (n: string) => schema.find((f) => f.name === n);

/** Ruft ein Abfragefeld mit allen Unterfeldern auf. */
async function call(name: string, vars: Record<string, unknown>, depth = 4): Promise<any> {
  const f = field(name);
  if (!f) return { error: "Feld fehlt" };
  const args = f.args.filter((a: any) => a.name in vars);
  const decl = args.map((a: any) => `$${a.name}: ${sig(a.type)}`).join(", ");
  const use = args.map((a: any) => `${a.name}: $${a.name}`).join(", ");
  const b = base(f.type);
  const sel = b.kind === "SCALAR" || b.kind === "ENUM" ? "" : `{ ${await selection(b.name!, depth)} }`;
  const q = `query ${name}${decl ? `(${decl})` : ""} { ${name}${use ? `(${use})` : ""} ${sel} }`;
  return gql(q, vars);
}

// Aufbau der relevanten Typen sichern
const types: Record<string, unknown> = {};
for (const n of FIELDS) {
  const f = field(n);
  if (!f) { say(`${n}: fehlt im Schema`); continue; }
  types[n] = { args: f.args.map((a: any) => `${a.name}: ${sig(a.type)}`), returns: sig(f.type) };
  say(`${n}(${f.args.map((a: any) => `${a.name}: ${sig(a.type)}`).join(", ")}) -> ${sig(f.type)}`);
  await selection(base(f.type).name!, 4);
  for (const a of f.args) { const b = base(a.type); if (b.kind !== "SCALAR") await typeInfo(b.name!); }
}
save("types", { fields: types, types: Object.fromEntries(typeCache) });

// --- Kalender ------------------------------------------------------------------------------
const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = new Date();
const from = iso(new Date(Date.now() - 14 * 864e5));
const to = iso(today);
const pick = (r: any) => r?.body?.data?.getCalendarEvents;
const summary = (r: any) => {
  const d = pick(r);
  if (!d) return JSON.stringify(r.body).slice(0, 400);
  const list = d.results ?? [];
  return `${d.hits ?? "?"} Treffer, ${list.length} geliefert: ` +
    list.slice(0, 12).map((c: any) => `${c.id} ${c.name} (${c.area ?? c.country ?? ""}, ${c.rankingCategory ?? ""}, ${c.startDate}–${c.endDate}, Ergebnisse=${c.hasResults ?? "?"})`).join("; ");
};

// 1. Kalender: Deutschland (ID aus den Optionen: 13188422), ganze Saison bis heute -> Umfang kleiner Meetings
const GER = 13188422;
let r: any;
let gerCal: any[] = [];
for (let offset = 0; offset < 1000; offset += 100) {
  r = await call("getCalendarEvents", { startDate: `${today.getFullYear()}-01-01`, endDate: to, regionType: "country", regionId: GER,
    limit: 100, offset, hideCompetitionsWithNoResults: true }, 2);
  const list = pick(r)?.results ?? [];
  if (offset === 0) say(`Kalender GER ${today.getFullYear()} mit Ergebnissen: ${summary(r)}`);
  gerCal.push(...list);
  if (list.length < 100) break;
}
save("calendar-ger-season", gerCal);
const cnt = (xs: any[], k: string) => Object.entries(xs.reduce((a: any, x: any) => ((a[x[k]] = (a[x[k]] ?? 0) + 1), a), {}));
say(`GER Saison: ${gerCal.length} Wettkämpfe; Kategorien ${JSON.stringify(cnt(gerCal, "rankingCategory"))}; Arten ${JSON.stringify(cnt(gerCal, "disciplines"))}`);
// Weltweit in einer Sommerwoche (Umfang für den stündlichen Abruf)
r = await call("getCalendarEvents", { startDate: `${today.getFullYear()}-06-01`, endDate: `${today.getFullYear()}-06-07`, limit: 1, offset: 0, hideCompetitionsWithNoResults: true }, 2);
say(`Weltweit 1.–7. Juni: ${pick(r)?.hits} Wettkämpfe mit Ergebnissen; Kategorien ${JSON.stringify(pick(r)?.options?.rankingCategories?.map((o: any) => [o.name, o.count]))}`);
r = await call("getCalendarEvents", { startDate: `${today.getFullYear()}-06-01`, endDate: `${today.getFullYear()}-06-07`, regionType: "country", regionId: GER, limit: 1, offset: 0, hideCompetitionsWithNoResults: true }, 2);
say(`GER 1.–7. Juni: ${pick(r)?.hits} Wettkämpfe mit Ergebnissen`);
r = await call("getCalendarEvents", { startDate: `${today.getFullYear()}-06-01`, endDate: `${today.getFullYear()}-06-07`, regionType: "area", regionId: 3, limit: 1, offset: 0, hideCompetitionsWithNoResults: true }, 2);
say(`Europa 1.–7. Juni: ${pick(r)?.hits} Wettkämpfe mit Ergebnissen`);

// --- Wettkampfergebnisse ----------------------------------------------------------------
const pool = new Set(readFileSync("research/athlete-ids.txt", "utf8").split(/\s+/).filter(Boolean).map(Number));
// kleines deutsches Meeting, großes deutsches Meeting (meiste Tage), Pforzheim, WM Tokio (7190593)
const multi = [...gerCal].sort((a, b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) - (Date.parse(a.endDate) - Date.parse(a.startDate)))[0];
const small = gerCal.find((c) => c.rankingCategory === "F" && /Track/.test(c.disciplines));
const picks = [small, multi, gerCal.find((c) => /Pforzheim/.test(c.name)), { id: 7190593, name: "WM Tokio" }].filter(Boolean);
for (const c of picks) {
  for (const day of [null, 1, 2]) {
    const res = await call("getCalendarCompetitionResults", { competitionId: Number(c.id), day, eventId: null }, 5);
    save(`competition-${c.id}-day${day}`, res);
    const data = res.body?.data?.getCalendarCompetitionResults;
    const races = (data?.eventTitles ?? []).flatMap((t: any) => (t.events ?? []).flatMap((e: any) => e.races ?? []));
    const results = races.flatMap((x: any) => x.results ?? []);
    const ours = results.filter((x: any) => pool.has(Number(x.competitor?.id)));
    say(`Wettkampf ${c.id} ${c.name} (${c.startDate}–${c.endDate}) Tag ${day}: ${races.length} Läufe, ${results.length} Ergebnisse, ` +
      `${ours.length} Pool-Athleten, ${JSON.stringify(res.body).length} Bytes; Fehler: ${JSON.stringify(res.body?.errors ?? null).slice(0, 200)}; ` +
      `Ergebnis-Beispiel: ${JSON.stringify(ours[0] ?? results[0] ?? null).slice(0, 500)}; ` +
      `Optionen: ${JSON.stringify(data?.options ?? null).slice(0, 400)}`);
  }
}

// --- Mehrere Athleten auf einmal ----------------------------------------------------------
const ids = [...pool].slice(0, 25);
for (const v of [{ athleteIds: ids, limit: 200 }, { athleteIds: ids.map(String), limit: 200 }, { athleteIds: ids.slice(0, 3), limit: 10 }]) {
  r = await call("resultsByAthlete", v, 4);
  save(`resultsByAthlete-${v.athleteIds.length}`, r);
  say(`resultsByAthlete(${v.athleteIds.length} Athleten): ${JSON.stringify(r.body).slice(0, 600)}`);
}
for (const v of [
  { ids, resultsByLimitsStartDate: from, resultsByLimitsEndDate: to },
  { ids: ids.slice(0, 3), resultsByLimitsStartDate: `${today.getFullYear()}-01-01`, resultsByLimitsEndDate: to },
  { id: ids[0], resultsByLimitsStartDate: `${today.getFullYear()}-01-01`, resultsByLimitsEndDate: to },
]) {
  r = await call("getSingleCompetitorResultsByLimit", v, 4);
  save(`byLimit-${v.ids?.length ?? 1}`, r);
  say(`getSingleCompetitorResultsByLimit(${JSON.stringify(v).slice(0, 80)}…): ${JSON.stringify(r.body).slice(0, 600)}`);
}
r = await call("competitionsByCountry", { countryOfResidence: "GER", limit: 20 }, 3);
save("competitionsByCountry", r);
say(`competitionsByCountry(GER): ${JSON.stringify(r.body).slice(0, 600)}`);

writeFileSync(`${OUT}/log.txt`, log.join("\n"));
