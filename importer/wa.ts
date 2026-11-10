import * as cheerio from "cheerio";

const WA_BASE = "https://worldathletics.org";
const USER_AGENT = "Mozilla/5.0 (compatible; FantasyAthletics/2.0)";

export type Gender = "M" | "W";

export type ToplistRow = {
  athleteId: number;
  name: string;
  birthDate: string | null; // ISO yyyy-mm-dd
  mark: string;
  score: number;
};

export type WaResult = {
  date: string; // ISO yyyy-mm-dd
  competition: string;
  venue: string | null;
  discipline: string;
  country: string | null;
  category: string | null;
  race: string;
  place: number | null;
  mark: string | null;
  resultScore: number | null;
  remark: string | null;
  competitionId: number | null;
  eventId: number | null;
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function toplistUrl(path: string, gender: Gender, year: number, country: string, page: number) {
  const g = gender === "M" ? "men" : "women";
  const params = new URLSearchParams({
    regionType: "countries",
    region: country,
    page: String(page),
    bestResultsOnly: "true",
    maxResultsByCountry: "all",
    ageCategory: "senior",
  });
  return `${WA_BASE}/records/toplists/${path}/all/${g}/senior/${year}?${params}`;
}

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

/** "18 OCT 2026" -> "2026-10-18" */
export function parseWaDate(s: string): string | null {
  const m = s?.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()];
  return month ? `${m[3]}-${month}-${m[1].padStart(2, "0")}` : null;
}

/** "12." -> 12, "" / "DNF" -> null */
export function parsePlace(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/^\s*(\d+)\.?\s*$/);
  return m ? Number(m[1]) : null;
}

export function athleteIdFromHref(href: string): number | null {
  const m = href.match(/(\d{5,})\/?(?:[?#].*)?$/) ?? href.match(/athlete=(\d+)/);
  return m ? Number(m[1]) : null;
}

export function parseToplist(html: string): ToplistRow[] {
  const $ = cheerio.load(html);
  const rows: ToplistRow[] = [];
  $("tr").each((_, tr) => {
    const row = $(tr);
    const link = row.find('td[data-th="Competitor"] a').first();
    if (!link.length) return;
    const athleteId = athleteIdFromHref(link.attr("href") ?? "");
    const score = Number(row.find('td[data-th="ResultScore"]').text().trim());
    if (!athleteId || !Number.isFinite(score)) return;
    const dob = parseWaDate(row.find('td[data-th="DOB"]').text());
    rows.push({
      athleteId,
      name: link.text().replace(/\s+/g, " ").trim(),
      birthDate: dob,
      mark: row.find('td[data-th="Mark"]').text().trim(),
      score,
    });
  });
  return rows;
}

async function fetchText(url: string, tries = 3): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      if (attempt >= tries) throw new Error(`GET ${url}: ${(e as Error).message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

/** Lädt alle Seiten einer Topliste, bis die Punktzahl unter `minScore` fällt. */
export async function fetchToplist(
  path: string, gender: Gender, year: number, country: string, minScore: number, maxPages = 20,
): Promise<ToplistRow[]> {
  const all: ToplistRow[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = parseToplist(await fetchText(toplistUrl(path, gender, year, country, page)));
    all.push(...rows.filter((r) => r.score >= minScore));
    if (rows.length === 0 || rows.some((r) => r.score < minScore)) break;
    await sleep(500);
  }
  return all;
}

// ---------------------------------------------------------------------------
// GraphQL-API
// ---------------------------------------------------------------------------

export type ApiConfig = { url: string; key: string };

/**
 * WA tauscht Endpoint und API-Key regelmäßig aus. Beide stehen im JavaScript der
 * Website, daher lesen wir sie bei Bedarf von dort aus.
 */
export async function discoverApiConfig(): Promise<ApiConfig> {
  const html = await fetchText(WA_BASE);
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], WA_BASE).href);
  let url: string | undefined;
  let key: string | undefined;
  for (const src of [WA_BASE, ...scripts]) {
    const js = src === WA_BASE ? html : await fetchText(src).catch(() => "");
    url ??= js.match(/https:\/\/graphql-prod-\d+\.edge\.aws\.worldathletics\.org\/graphql/)?.[0];
    key ??= js.match(/da2-[a-z0-9]{26}/)?.[0];
    if (url && key) return { url, key };
  }
  throw new Error("WA-API-Konfiguration nicht auf der Website gefunden");
}

const RESULTS_QUERY = `
  query GetSingleCompetitorResultsDate($id: Int, $resultsByYearOrderBy: String, $resultsByYear: Int) {
    getSingleCompetitorResultsDate(id: $id, resultsByYear: $resultsByYear, resultsByYearOrderBy: $resultsByYearOrderBy) {
      resultsByDate {
        date competition venue discipline country category race place mark resultScore remark competitionId eventId
      }
    }
  }`;

export class ApiAuthError extends Error {}

type RawResult = Record<string, string | number | null | undefined>;

export function mapResult(r: RawResult): WaResult | null {
  const date = parseWaDate(String(r.date ?? ""));
  if (!date || !r.discipline) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
  const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  return {
    date,
    competition: String(r.competition ?? ""),
    venue: str(r.venue),
    discipline: String(r.discipline),
    country: str(r.country),
    category: str(r.category),
    race: String(r.race ?? ""),
    place: parsePlace(r.place as string),
    mark: str(r.mark),
    resultScore: num(r.resultScore),
    remark: str(r.remark),
    competitionId: num(r.competitionId),
    eventId: num(r.eventId),
  };
}

export async function fetchAthleteResults(api: ApiConfig, athleteId: number, year: number): Promise<WaResult[]> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(api.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": USER_AGENT },
      body: JSON.stringify({
        operationName: "GetSingleCompetitorResultsDate",
        query: RESULTS_QUERY,
        variables: { id: athleteId, resultsByYear: year, resultsByYearOrderBy: "date" },
      }),
    }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
    if (res.status === 401 || res.status === 403) throw new ApiAuthError(`WA-API ${res.status}`);
    if (res.ok) {
      const body = (await res.json()) as {
        data?: { getSingleCompetitorResultsDate?: { resultsByDate?: RawResult[] } };
        errors?: { message: string; errorType?: string }[];
      };
      if (body.errors?.some((e) => /unauthori[sz]ed|api key/i.test(e.message + (e.errorType ?? "")))) {
        throw new ApiAuthError(body.errors[0].message);
      }
      const raw = body.data?.getSingleCompetitorResultsDate?.resultsByDate ?? [];
      return raw.map(mapResult).filter((r): r is WaResult => r !== null);
    }
    if (attempt >= 4) throw new Error(`WA-API ${res.status} ${res.statusText} für Athlet ${athleteId}`);
    await sleep(1000 * 2 ** attempt + Math.random() * 1000);
  }
}
