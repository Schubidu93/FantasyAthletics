// Persönliche Bestleistungen aus getSingleCompetitor (personalBests, progressionOfSeasonsBests) aufbereiten.
import { markCost } from "./marks";
import { parseWaDate } from "./wa";

export type RawPb = { indoor?: boolean | null; discipline?: string | null; mark?: string | null; notLegal?: boolean | null;
                      venue?: string | null; date?: string | null; resultScore?: number | null };
export type RawProgression = { discipline?: string | null; indoor?: boolean | null;
                               results?: { season?: string | number | null; mark?: string | null; date?: string | null }[] | null };

/** Disziplinname wie in unseren Ergebnissen: Hallenleistungen heißen dort „… Short Track“. */
export function pbDiscipline(name: string, indoor: boolean, known: Set<string>) {
  if (indoor && !/short track/i.test(name) && known.has(`${name} Short Track`)) return `${name} Short Track`;
  return name;
}

/** Aktuelle Bestleistungen für das Profil (ohne irreguläre). */
export function currentPbs(athleteId: string, raw: RawPb[], known: Set<string>) {
  const out = new Map<string, { athlete_id: string; discipline: string; mark: string; date: string | null; result_score: number | null; venue: string | null }>();
  for (const r of raw) {
    if (!r.discipline || !r.mark || r.notLegal) continue;
    const discipline = pbDiscipline(r.discipline, !!r.indoor, known);
    const prev = out.get(discipline);
    const s = markCost(discipline, r.mark);
    if (prev && s !== null && (markCost(discipline, prev.mark) ?? Infinity) <= s) continue;
    out.set(discipline, { athlete_id: athleteId, discipline, mark: r.mark, date: parseWaDate(r.date ?? ""),
                          result_score: r.resultScore ?? null, venue: r.venue ?? null });
  }
  // WA führt alte Hallenzeiten teils zusätzlich als Bahn-Bestleistung → gleiche Zeit am gleichen Tag nur als Halle
  const indoor = new Set([...out.values()].filter((p) => /short track/i.test(p.discipline)).map((p) => `${p.discipline.replace(/ Short Track$/i, "")}|${p.mark}|${p.date}`));
  return [...out.values()].filter((p) => /short track/i.test(p.discipline) || !indoor.has(`${p.discipline}|${p.mark}|${p.date}`));
}

/** Beste Leistung vor `beforeYear` je Disziplin aus den Saisonbestleistungen (kleinerer Vergleichswert = besser, siehe markCost). */
export function bestBefore(athleteId: string, progression: RawProgression[], beforeYear: number, known: Set<string>) {
  const out = new Map<string, { athlete_id: string; discipline: string; mark: string; date: string | null; s: number }>();
  for (const p of progression) {
    if (!p.discipline) continue;
    const discipline = pbDiscipline(p.discipline, !!p.indoor, known);
    for (const r of p.results ?? []) {
      const s = markCost(discipline, r.mark);
      if (s === null || !r.mark || Number(r.season) >= beforeYear) continue;
      const prev = out.get(discipline);
      if (!prev || s < prev.s) out.set(discipline, { athlete_id: athleteId, discipline, mark: r.mark, date: parseWaDate(r.date ?? ""), s });
    }
  }
  const indoor = new Set([...out.values()].filter((p) => /short track/i.test(p.discipline)).map((p) => `${p.discipline.replace(/ Short Track$/i, "")}|${p.mark}|${p.date}`));
  return [...out.values()].filter((p) => /short track/i.test(p.discipline) || !indoor.has(`${p.discipline}|${p.mark}|${p.date}`))
    .map(({ s: _s, ...rest }) => rest);
}
