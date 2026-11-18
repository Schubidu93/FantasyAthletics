// Platzierungen, die sich nicht direkt aus den Athletenergebnissen ablesen lassen.
// Dafür laden wir die Detailergebnisse des Events (alle Läufe aller Runden).
//
// 1. Finals mit mehreren Läufen (F1, F2, ...): kombinierte Platzierung über alle Finalläufe.
//    Beispiel: In F1 Fünfter, in F2 waren zwei Läufer schneller -> Platz 7, gewertet als "F".
//
// 2. Letzte Runde vor dem Finale (nur Kategorien OW, DF, GW, GL; WA-Regeln Tab. 2.3–2.8):
//    - für das Finale qualifiziert (Q oder q) -> fester Wert (place 0)
//    - sonst Gesamtplatz der Runde: Anzahl Qualifizierte + Rang unter den Nicht-Qualifizierten
//      nach Zeit (bei 8 Finalisten ist der schnellste Ausgeschiedene also 9.)
//    - Tabelle hängt von der Finalgröße ab: P9 (max. 9 Finalisten) oder P10 (10 und mehr)
//
// Q/q steht in der GraphQL-Antwort im Feld `qualified`: false = qualifiziert (Q und q!),
// null = ausgeschieden. Zusätzlich gilt als qualifiziert, wer in der Finalliste steht.
import * as cheerio from "cheerio";
import { markCost } from "./marks";
export { parseMark } from "./marks";
import type { ApiConfig } from "./wa";

export type RaceEntry = {
  athleteId: number | null;
  name: string;
  mark: string;
  place: number | null;
  qualified: boolean;
};
export type Race = { name: string; number: number | null; date: string | null; entries: RaceEntry[] };
export type Athlete = { id?: number; name?: string };

export const PRELIM_CATEGORIES = ["OW", "DF", "GW", "GL"];

/** "F1", "F2" ... */
export function isSplitFinal(race: string) {
  return /^F\d+$/.test(race);
}

/** WA-Laufbezeichnung eines Athletenergebnisses ist eine Vorrunde (Vorlauf, Viertel-, Halbfinale)? */
export function isPrelimRace(race: string) {
  return /^(H|QF|SF|R)\d*$/.test(race);
}

/** "Final", "Final 1", "Final A", "F2" */
export function isFinalRaceName(name: string) {
  const n = name.trim();
  return /^final(\s*[-–]?\s*[a-z0-9]+)?$/i.test(n) || /^F\d*$/.test(n);
}

/** Runde, aus der man in das Finale kommt, z. B. "Semifinal - Heat", "Round 1 - Heat". */
function isPrelimRoundName(name: string) {
  return !isFinalRaceName(name) && !/combined|group|qualification/i.test(name) && name.trim() !== "";
}

/** "Hannes  BURGER" -> "hannes burger" */
export function normalizeName(name: string) {
  return name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function findEntry(entries: RaceEntry[], athlete: Athlete) {
  const target = athlete.name ? normalizeName(athlete.name) : null;
  return entries.find((e) => athlete.id && e.athleteId === athlete.id)
    ?? (target ? entries.find((e) => normalizeName(e.name) === target) : undefined);
}

const finalsOf = (competitions: Race[]) => competitions.filter((r) => isFinalRaceName(r.name));

/**
 * Kombinierter Finalplatz = 1 + Anzahl der Athleten aller Finalläufe mit besserer Leistung (Sprung/Wurf: weiter, siehe markCost)
 * (gleiche Zeit = gleicher Platz). Athlet über ID oder Namen, ersatzweise über seine Zeit.
 */
export function combinedPlace(competitions: Race[], mark: string | null, athlete: Athlete = {}, discipline = ""): number | null {
  const finals = finalsOf(competitions);
  const entries = finals.flatMap((r) => r.entries);
  const own = findEntry(entries, athlete);
  if (finals.length === 1) return own?.place ?? null; // nur ein Finallauf gelistet
  if (finals.length < 2) return null;
  const mine = markCost(discipline, own?.mark ?? mark);
  if (mine === null) return null;
  const times = entries.map((e) => markCost(discipline, e.mark)).filter((t): t is number => t !== null);
  if (!own && !times.some((t) => t === mine)) return null; // Athlet nicht gefunden -> Daten passen nicht
  return 1 + times.filter((t) => t < mine).length;
}

export type PrelimPlacing = { round: "P9" | "P10"; place: number };

/**
 * Wertung in der letzten Runde vor dem Finale. null, wenn der Athlet nicht in dieser Runde
 * lief (z. B. nur im Vorlauf vor einem Halbfinale) oder die Daten nicht passen.
 */
export function prelimPlacing(competitions: Race[], athlete: Athlete, discipline = ""): PrelimPlacing | null {
  const finals = finalsOf(competitions);
  const finalists = finals.flatMap((r) => r.entries);
  if (!finalists.length) return null;

  // Runden in Reihenfolge des letzten Datums; die späteste vor dem Finale zählt.
  const rounds = new Map<string, Race[]>();
  for (const r of competitions.filter((r) => isPrelimRoundName(r.name))) {
    rounds.set(r.name, [...(rounds.get(r.name) ?? []), r]);
  }
  const lastDate = (rs: Race[]) => rs.map((r) => r.date ?? "").sort().at(-1) ?? "";
  const last = [...rounds.values()].sort((a, b) => lastDate(b).localeCompare(lastDate(a)))[0];
  if (!last) return null;

  const entries = last.flatMap((r) => r.entries);
  const own = findEntry(entries, athlete);
  if (!own) return null;

  const inFinal = (e: RaceEntry) => e.qualified || !!findEntry(finalists, { id: e.athleteId ?? undefined, name: e.name });
  const round = finalists.length <= 9 ? "P9" : "P10";
  if (inFinal(own)) return { round, place: 0 };

  const mine = markCost(discipline, own.mark);
  if (mine === null) return null; // DNF/DNS/DQ
  const qualifiedCount = entries.filter(inFinal).length;
  const fasterOut = entries.filter((e) => !inFinal(e)).map((e) => markCost(discipline, e.mark))
    .filter((t): t is number => t !== null && t < mine).length;
  return { round, place: qualifiedCount + 1 + fasterOut };
}

// ---------------------------------------------------------------------------
// Extraktion
// ---------------------------------------------------------------------------

type Json = unknown;

/** WA-ID aus urlSlug ("canada/marco-arop-14755875") oder einer numerischen ID. */
function idFrom(...candidates: unknown[]): number | null {
  for (const v of candidates) {
    if (typeof v === "number" && v > 1_000_000) return v;
    if (typeof v === "string") {
      const m = v.match(/^\d{6,}$/) ?? v.match(/[-=/](\d{6,})\/?$/);
      if (m) return Number(m[1] ?? m[0]);
    }
  }
  return null;
}

/** Sucht in beliebigem JSON nach Rennen: Objekte mit einer `results`-Liste von Einträgen mit `mark`. */
export function extractRacesFromJson(json: Json): Race[] {
  const competitions: Race[] = [];
  const walk = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, Json>;
    const results = obj.results;
    if (Array.isArray(results) && results.some((r) => r && typeof r === "object" && "mark" in (r as object))) {
      competitions.push({
        name: String(obj.race ?? obj.raceName ?? obj.name ?? ""),
        number: obj.raceNumber == null ? null : Number(obj.raceNumber),
        date: obj.date ? String(obj.date) : null,
        entries: results.map((r) => {
          const e = r as Record<string, Json>;
          const c = (e.competitor ?? {}) as Record<string, Json>;
          return {
            athleteId: idFrom(c.urlSlug, c.aaAthleteId, c.id, e.competitorId),
            name: String(c.name ?? e.name ?? ""),
            mark: String(e.mark ?? ""),
            place: Number.parseInt(String(e.place ?? ""), 10) || null,
            qualified: e.qualified === false || e.qualified === true || /^q$/i.test(String(e.qualified ?? "")),
          };
        }),
      });
    }
    Object.values(obj).forEach(walk);
  };
  walk(json);
  return competitions;
}

/** Teilbaum mit `eventId === id` (falls die Daten mehrere Events enthalten). */
export function findEventNode(node: Json, id: number): Json | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findEventNode(n, id);
      if (hit) return hit;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, Json>;
  if (Number(obj.eventId) === id && Object.values(obj).some((v) => Array.isArray(v))) return obj;
  for (const v of Object.values(obj)) {
    const hit = findEventNode(v, id);
    if (hit) return hit;
  }
  return null;
}

/** Ergebnisseite: eingebettete Daten (__NEXT_DATA__), sonst Überschriften + Tabellen. */
export function extractRacesFromHtml(html: string, eventId?: number): Race[] {
  const $ = cheerio.load(html);
  const next = $("script#__NEXT_DATA__").text();
  if (next) {
    try {
      const data = JSON.parse(next);
      const competitions = extractRacesFromJson((eventId && findEventNode(data, eventId)) || data);
      if (competitions.length) return competitions;
    } catch {
      // weiter mit dem HTML
    }
  }

  const competitions: Race[] = [];
  let current: Race | null = null;
  // Zeit mit Doppelpunkt oder Nachkommastellen, damit Bahn-/Startnummern nicht als Zeit gelten.
  const timeRe = /^\d{1,2}(:\d{2}){1,2}(\.\d+)?$|^\d{1,2}\.\d+$/;
  $("h1, h2, h3, h4, strong, table").each((_, el) => {
    const node = $(el);
    if (el.tagName !== "table") {
      const text = node.text().replace(/\s+/g, " ").trim();
      if (/^(final|semi-?final|heat|race|quarter|round)/i.test(text) && text.length < 30) {
        current = { name: text, number: null, date: null, entries: [] };
        competitions.push(current);
      }
      return;
    }
    if (!current) return;
    node.find("tr").each((__, tr) => {
      const row = $(tr);
      const link = row.find('[class*="EventResults_name"] a, a[href*="/athletes/"]').first();
      if (!link.length) return;
      // Wie im alten Apps Script: die erste Zeit nach der Namensspalte.
      const cells = row.find("td").toArray();
      const nameIdx = cells.findIndex((td) => $(td).find(link).length > 0);
      const after = cells.slice(nameIdx + 1).map((td) => $(td).text().trim());
      const mark = after.find((t) => timeRe.test(t));
      if (!mark) return;
      current!.entries.push({
        athleteId: idFrom(link.attr("href")),
        name: link.text().trim(),
        mark,
        place: Number.parseInt($(cells[0]).text(), 10) || null,
        qualified: after.some((t) => /^q$/i.test(t)),
      });
    });
  });
  return competitions.filter((r) => r.entries.length > 0);
}

// ---------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------

// Ein Event kann in mehreren Wertungen stehen: offenes Rennen (eventTitle leer, z. B. Kategorie E) und eine eingebettete
// Meisterschaft (eventTitle „German Marathon Ch.“, Kategorie B) mit eigener Platzierung.
export type EventBlock = { category: string | null; title: string | null; races: Race[] };

const COMPETITION_QUERY = `
  query getCalendarCompetitionResults($competitionId: Int, $day: Int, $eventId: Int) {
    getCalendarCompetitionResults(competitionId: $competitionId, day: $day, eventId: $eventId) {
      eventTitles { rankingCategory eventTitle events { eventId races { date race raceNumber
        results { competitor { id name urlSlug } mark place qualified } } } }
    }
  }`;

/** Blöcke aus `eventTitles` (GraphQL-Antwort oder __NEXT_DATA__ der Ergebnisseite). */
export function blocksFromEventTitles(eventTitles: unknown, eventId: number): EventBlock[] {
  if (!Array.isArray(eventTitles)) return [];
  return eventTitles.map((t) => {
    const title = t as { rankingCategory?: string | null; eventTitle?: string | null; events?: { eventId?: number }[] };
    const events = (title.events ?? []).filter((e) => Number(e.eventId) === eventId);
    return { category: title.rankingCategory ?? null, title: title.eventTitle || null, races: extractRacesFromJson(events) };
  }).filter((b) => b.races.length);
}

/** Läufe der Hauptwertung (offenes Rennen; ohne eingebettete Meisterschaft). */
export function mainRaces(blocks: EventBlock[]): Race[] {
  const main = blocks.filter((b) => !b.title);
  return (main.length ? main : blocks.slice(0, 1)).flatMap((b) => b.races);
}

/**
 * Eingebettete Meisterschaft: Platz des Athleten im Finale eines Blocks mit eigenem Titel, wenn es daneben die
 * Hauptwertung gibt. Liefert auch die Kategorie der Hauptwertung (WA schreibt beim Athleten sonst die der Meisterschaft).
 */
export function championshipPlacing(blocks: EventBlock[], athlete: Athlete):
  { place: number; category: string | null; title: string; mainCategory: string | null } | null {
  const main = blocks.find((b) => !b.title);
  if (!main) return null;
  for (const b of blocks.filter((x) => x.title)) {
    const own = findEntry(finalsOf(b.races).flatMap((r) => r.entries), athlete);
    if (own?.place) return { place: own.place, category: b.category, title: b.title!, mainCategory: main.category };
  }
  return null;
}

export async function fetchEventBlocks(api: ApiConfig, competitionId: number, eventId: number): Promise<EventBlock[]> {
  // 1. GraphQL-API (liefert auch Q/q)
  let apiError: string | null = null;
  try {
    const res = await fetch(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": api.key },
      body: JSON.stringify({
        operationName: "getCalendarCompetitionResults",
        query: COMPETITION_QUERY,
        variables: { competitionId, eventId, day: null },
      }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { data?: { getCalendarCompetitionResults?: { eventTitles?: unknown } }; errors?: { message: string }[] };
    if (body.errors?.length) throw new Error(body.errors[0].message);
    const blocks = blocksFromEventTitles(body.data?.getCalendarCompetitionResults?.eventTitles, eventId);
    if (blocks.length) return blocks;
    apiError = "keine Läufe";
  } catch (e) {
    apiError = (e as Error).message;
  }

  // 2. Ergebnisseite (so hat es das alte Apps Script gemacht)
  const url = `https://worldathletics.org/competition/calendar-results/results/${competitionId}?eventId=${eventId}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" } });
  if (!res.ok) throw new Error(`API: ${apiError}; Ergebnisseite: ${res.status}`);
  const html = await res.text();
  try {
    const next = JSON.parse(cheerio.load(html)("script#__NEXT_DATA__").text() || "null");
    const blocks = blocksFromEventTitles(next?.props?.pageProps?.calendarEventsResults?.eventTitles, eventId);
    if (blocks.length) return blocks;
  } catch {
    // weiter mit dem HTML
  }
  return [{ category: null, title: null, races: extractRacesFromHtml(html, eventId) }];
}

/** Läufe der Hauptwertung eines Events. */
export async function fetchEventRaces(api: ApiConfig, competitionId: number, eventId: number): Promise<Race[]> {
  return mainRaces(await fetchEventBlocks(api, competitionId, eventId));
}
