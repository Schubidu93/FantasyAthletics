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
async function call(name: string, vars: Record<string, unknown>, depth = 4) {
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

// 1. ohne Filter, mit Optionen (zeigt die IDs für Land, Kategorie, Art)
let r = await call("getCalendarEvents", { startDate: from, endDate: to, limit: 50, offset: 0, showOptionsWithNoHits: true, hideCompetitionsWithNoResults: true, orderDirection: "Descending" }, 3);
save("calendar-all", r);
say(`Kalender ${from}–${to}, nur mit Ergebnissen: ${summary(r)}`);
const options = pick(r)?.options ?? {};
say(`Optionen: ${Object.keys(options).join(", ")}`);
const opt = (key: RegExp) => Object.entries(options).find(([k]) => key.test(k))?.[1] as any[] | undefined;
const regionOpts = opt(/region/i) ?? [];
const ger = (opt(/countr|region/i) ?? []).find((o: any) => /GER|Germany/i.test(JSON.stringify(o)));
say(`Deutschland in Optionen: ${JSON.stringify(ger)}; Regionsoptionen: ${JSON.stringify(regionOpts).slice(0, 300)}`);

// 2. Filter Land Deutschland (verschiedene Schreibweisen ausprobieren)
const gerIds = [ger?.id, ger?.value, "GER", 84].filter((x) => x !== undefined);
let gerCal: any = null;
for (const regionType of ["countries", "country"]) {
  for (const regionId of gerIds) {
    r = await call("getCalendarEvents", { startDate: from, endDate: to, regionType, regionId: Number(regionId) || regionId, limit: 100, offset: 0, hideCompetitionsWithNoResults: true }, 3);
    say(`Kalender GER (${regionType}=${regionId}): ${summary(r)}`);
    if (pick(r)?.results?.length && !gerCal) { gerCal = r; save("calendar-ger", r); }
  }
}

// 3. Ohne hideCompetitionsWithNoResults (zum Vergleich) und mit Kategorie / Art
r = await call("getCalendarEvents", { startDate: from, endDate: to, limit: 100, offset: 0 }, 3);
save("calendar-all-incl-no-results", r);
say(`Kalender inkl. ohne Ergebnisse: ${summary(r)}`);
for (const [k, v] of Object.entries(options)) {
  if (!Array.isArray(v)) continue;
  say(`Option ${k}: ${JSON.stringify(v.slice(0, 40)).slice(0, 1500)}`);
}

// --- Wettkampfergebnisse ----------------------------------------------------------------
const pool = new Set(readFileSync("research/athlete-ids.txt", "utf8").split(/\s+/).filter(Boolean).map(Number));
const comps: any[] = (pick(gerCal) ?? pick(await call("getCalendarEvents", { startDate: from, endDate: to, limit: 20, offset: 0, hideCompetitionsWithNoResults: true }, 3)))?.results ?? [];
for (const c of comps.slice(0, 4)) {
  const res = await call("getCalendarCompetitionResults", { competitionId: Number(c.id), day: null, eventId: null }, 5);
  save(`competition-${c.id}`, res);
  const data = res.body?.data?.getCalendarCompetitionResults;
  const races = (data?.eventTitles ?? []).flatMap((t: any) => (t.events ?? []).flatMap((e: any) => e.races ?? []));
  const results = races.flatMap((x: any) => x.results ?? []);
  const ours = results.filter((x: any) => pool.has(Number(x.competitor?.id)));
  say(`Wettkampf ${c.id} ${c.name}: ${races.length} Läufe, ${results.length} Ergebnisse, ${ours.length} Pool-Athleten; ` +
    `Felder Ergebnis: ${Object.keys(results[0] ?? {}).join(",")}; Felder Wettkampf: ${Object.keys(data?.competition ?? {}).join(",")}; ` +
    `Tage-Optionen: ${JSON.stringify(data?.options ?? null).slice(0, 300)}`);
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
  save(`byLimit-${"ids" in v ? v.ids.length : 1}`, r);
  say(`getSingleCompetitorResultsByLimit(${JSON.stringify(v).slice(0, 80)}…): ${JSON.stringify(r.body).slice(0, 600)}`);
}
r = await call("competitionsByCountry", { countryOfResidence: "GER", limit: 20 }, 3);
save("competitionsByCountry", r);
say(`competitionsByCountry(GER): ${JSON.stringify(r.body).slice(0, 600)}`);

writeFileSync(`${OUT}/log.txt`, log.join("\n"));
