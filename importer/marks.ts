// Leistungen vergleichen: Zeit, Weite, Höhe oder Punkte als Zahl, und welche besser ist.
import { higherBetter } from "./disciplines";

/** Leistung als Zahl: Zeit in Sekunden ("46.12", "1:46.60", "2:10:33"), Weite/Höhe in Metern, Mehrkampfpunkte. DNF/DNS/DQ -> null. */
export function parseMark(mark: string | null | undefined): number | null {
  const m = String(mark ?? "").trim().replace(",", ".").match(/^(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)/);
  if (!m) return null;
  const parts = m[1].split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Vergleichswert einer Leistung: kleiner = besser (wie `_mark_cost` in der Datenbank). */
export function markCost(discipline: string, mark: string | null | undefined): number | null {
  const v = parseMark(mark);
  return v === null ? null : higherBetter(discipline) ? -v : v;
}
