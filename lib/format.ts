export const GROUPS = ["800", "1500", "5000", "10000", "Marathon", "Hindernis"] as const;

export function slotLabel(slot: string) {
  const wc = slot.match(/^WC(\d+)$/);
  if (wc) return `Wildcard ${wc[1]}`;
  return /^\d+$/.test(slot) ? `${slot} m` : slot;
}

export function isWildcard(slot: string) {
  return slot.startsWith("WC");
}

export function fmtPoints(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return v.toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "–";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}.${m}.${y}`;
}

export function fmtDateTime(d: string | null | undefined) {
  if (!d) return "–";
  return new Date(d).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
}

export function berlinToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

export const STATUS_LABEL: Record<string, string> = {
  setup: "Vorbereitung",
  drafting: "Draft läuft",
  active: "Saison läuft",
  finished: "Beendet",
};
