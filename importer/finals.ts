// Kombinierte Platzierung bei Finals mit mehreren Läufen (F1, F2, ...).
//
// Beispiel: Athlet A wird in F1 Fünfter, in F2 waren zwei Läufer schneller als er.
// Dann ist seine kombinierte Platzierung 7 und das Ergebnis wird als Lauf "F" gewertet.
//
// Die Detailergebnisse lesen wir wie das alte Apps Script von der Ergebnisseite auf
// worldathletics.org (eingebettete Daten bzw. HTML-Tabellen), ersatzweise über die GraphQL-API.
import * as cheerio from "cheerio";
import type { ApiConfig } from "./wa";

export type RaceEntry = { athleteId: number | null; name: string; mark: string };
export type Race = { name: string; entries: RaceEntry[] };

/** "F1", "F2" ... */
export function isSplitFinal(race: string) {
  return /^F\d+$/.test(race);
}

/** Renn-Bezeichnung der Detailseite ("Final 1", "Final A", "F2", "Final") ist ein Finallauf? */
export function isFinalRaceName(name: string) {
  const n = name.trim();
  return /^final(\s*[-–]?\s*[a-z0-9]+)?$/i.test(n) || /^F\d*$/.test(n);
}

/** Zeit in Sekunden: "46.12", "1:46.60", "13:45.23", "2:10:33", "2:10:33.4". DNF/DNS/DQ -> null. */
export function parseMark(mark: string | null | undefined): number | null {
  const m = String(mark ?? "").trim().replace(",", ".").match(/^(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)/);
  if (!m) return null;
  const parts = m[1].split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** "Hannes  BURGER" -> "hannes burger" */
export function normalizeName(name: string) {
  return name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Kombinierter Platz = 1 + Anzahl der Läufer aller Finalläufe mit einer schnelleren Zeit.
 * Gleiche Zeit = gleicher Platz. Der Athlet wird über ID oder Namen gesucht (wie im alten
 * Apps Script), ersatzweise über seine Zeit aus den eigenen Ergebnissen.
 */
export function combinedPlace(
  races: Race[], mark: string | null, athlete: { id?: number; name?: string } = {},
): number | null {
  const finals = races.filter((r) => isFinalRaceName(r.name));
  if (finals.length < 2) return null;
  const entries = finals.flatMap((r) => r.entries);
  const target = athlete.name ? normalizeName(athlete.name) : null;
  const own = entries.find((e) => athlete.id && e.athleteId === athlete.id)
    ?? (target ? entries.find((e) => normalizeName(e.name) === target) : undefined);
  const mine = parseMark(own?.mark ?? mark);
  if (mine === null) return null;
  const times = entries.map((e) => parseMark(e.mark)).filter((t): t is number => t !== null);
  if (!own && !times.some((t) => t === mine)) return null; // Athlet nicht gefunden -> Daten passen nicht
  return 1 + times.filter((t) => t < mine).length;
}

// ---------------------------------------------------------------------------
// Extraktion
// ---------------------------------------------------------------------------

type Json = unknown;

function idFrom(v: unknown): number | null {
  if (typeof v === "number" && v > 1000) return v;
  const m = String(v ?? "").match(/(\d{5,})/);
  return m ? Number(m[1]) : null;
}

/** Sucht in beliebigem JSON nach Rennen: Objekte mit einer `results`-Liste von Einträgen mit `mark`. */
export function extractRacesFromJson(json: Json): Race[] {
  const races: Race[] = [];
  const walk = (node: Json) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, Json>;
    const results = obj.results;
    if (Array.isArray(results) && results.some((r) => r && typeof r === "object" && "mark" in (r as object))) {
      const name = String(obj.race ?? obj.raceName ?? obj.name ?? "");
      races.push({
        name,
        entries: results.map((r) => {
          const e = r as Record<string, Json>;
          const c = (e.competitor ?? {}) as Record<string, Json>;
          return {
            athleteId: idFrom(c.id ?? c.aaAthleteId ?? c.urlSlug ?? e.competitorId),
            name: String(c.name ?? e.name ?? ""),
            mark: String(e.mark ?? ""),
          };
        }),
      });
    }
    Object.values(obj).forEach(walk);
  };
  walk(json);
  return races;
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

/** Fallback für die HTML-Ergebnisseite: Überschriften "Final 1" gefolgt von Ergebnistabellen. */
export function extractRacesFromHtml(html: string, eventId?: number): Race[] {
  const $ = cheerio.load(html);
  const next = $("script#__NEXT_DATA__").text();
  if (next) {
    try {
      const data = JSON.parse(next);
      const races = extractRacesFromJson((eventId && findEventNode(data, eventId)) || data);
      if (races.length) return races;
    } catch {
      // weiter mit dem HTML
    }
  }

  const races: Race[] = [];
  let current: Race | null = null;
  // Zeit mit Doppelpunkt oder Nachkommastellen, damit Bahn-/Startnummern nicht als Zeit gelten.
  const timeRe = /^\d{1,2}(:\d{2}){1,2}(\.\d+)?$|^\d{1,2}\.\d+$/;
  $("h1, h2, h3, h4, strong, table").each((_, el) => {
    const node = $(el);
    if (el.tagName !== "table") {
      const text = node.text().replace(/\s+/g, " ").trim();
      if (/^(final|semi-?final|heat|race|quarter)/i.test(text) && text.length < 30) {
        current = { name: text, entries: [] };
        races.push(current);
      }
      return;
    }
    if (!current) return;
    node.find("tr").each((__, tr) => {
      const row = $(tr);
      const link = row.find('[class*="EventResults_name"] a, a[href*="/athletes/"]').first();
      if (!link.length) return;
      // Wie im alten Skript: die erste Zeit nach der Namensspalte.
      const cells = row.find("td").toArray();
      const nameIdx = cells.findIndex((td) => $(td).find(link).length > 0);
      const mark = cells.slice(nameIdx + 1).map((td) => $(td).text().trim()).find((t) => timeRe.test(t));
      if (!mark) return;
      current!.entries.push({ athleteId: idFrom(link.attr("href")), name: link.text().trim(), mark });
    });
  });
  return races.filter((r) => r.entries.length > 0);
}

// ---------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------

const COMPETITION_QUERY = `
  query getCalendarCompetitionResults($competitionId: Int, $day: Int, $eventId: Int) {
    getCalendarCompetitionResults(competitionId: $competitionId, day: $day, eventId: $eventId) {
      eventTitles { events { eventId races { race raceNumber results { competitor { id name } mark place } } } }
    }
  }`;

export async function fetchEventRaces(api: ApiConfig, competitionId: number, eventId: number): Promise<Race[]> {
  // 1. Ergebnisseite (so hat es das alte Apps Script gemacht)
  const url = `https://worldathletics.org/competition/calendar-results/results/${competitionId}?eventId=${eventId}`;
  let htmlError: string | null = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" } });
    if (!res.ok) throw new Error(String(res.status));
    const races = extractRacesFromHtml(await res.text(), eventId);
    if (races.filter((r) => isFinalRaceName(r.name)).length >= 2) return races;
    htmlError = "keine Finalläufe gefunden";
  } catch (e) {
    htmlError = (e as Error).message;
  }

  // 2. GraphQL-API
  const res = await fetch(api.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api.key },
    body: JSON.stringify({
      operationName: "getCalendarCompetitionResults",
      query: COMPETITION_QUERY,
      variables: { competitionId, eventId, day: null },
    }),
  });
  if (!res.ok) throw new Error(`Ergebnisseite: ${htmlError}; API: ${res.status}`);
  const body = (await res.json()) as { data?: { getCalendarCompetitionResults?: { eventTitles?: { events?: { eventId?: number }[] }[] } } };
  // Nur das gesuchte Event, falls die API mehrere liefert.
  const events = (body.data?.getCalendarCompetitionResults?.eventTitles ?? []).flatMap((t) => t.events ?? []);
  const event = events.find((e) => Number(e.eventId) === eventId) ?? (events.length === 1 ? events[0] : null);
  return event ? extractRacesFromJson(event) : [];
}
