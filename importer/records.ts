// Rekord-Erkennung aus All-time-Listen (alle Leistungen, bestbewertete zuerst).
// Eine Leistung ab `since` war ein Rekord, wenn es bis zu ihrem Tag keine bessere gab
// (gleiche Zeit = Rekord eingestellt, zählt auch). Bessere Leistung am selben Tag (z. B. im selben Rennen) → kein Rekord.
import { parseMark } from "./placings";
import type { ToplistRow } from "./wa";

export function recordMarks(rows: ToplistRow[], since: string): ToplistRow[] {
  const timed = rows.map((r) => ({ r, s: parseMark(r.mark) })).filter((x) => x.s !== null && x.r.date) as { r: ToplistRow; s: number }[];
  return timed
    .filter((x) => x.r.date! >= since)
    .filter((x) => !timed.some((o) => o.s < x.s && o.r.date! <= x.r.date!))
    .map((x) => x.r);
}
