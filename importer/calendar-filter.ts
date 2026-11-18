// Kalender: Erkennen, welche Bereiche (Lauf, Sprint, Hürden, Sprung, Wurf, Mehrkampf, Gehen – wie die Liga-Bereiche) ein
// Wettkampf für Erwachsene anbietet – aus dem Programm oder ersatzweise aus dem Namen.

// Programm („Events to be staged“): „100m“, „400mH“, „1500m“, „3000mSC“, „5 km Road“, „Long Jump“, „20 km Race Walk“ …
// Jugend, Masters und Staffeln zählen nicht.
export const NOT_SENIOR = /\bU\s?\d{2}\b|\b[MW]\s?\d{2}\b|4\s*x|relay|staffel|masters/i;
const AREA_EVENT: [string, RegExp][] = [
  ["Gehen", /walk|\bRW\b|gehen/i],
  ["Hürden", /^\d+\s*m\s*H\b|hurdles/i],
  ["Mehrkampf", /decathlon|heptathlon|pentathlon|combined/i],
  ["Sprung", /jump|vault/i],
  ["Wurf", /throw|shot ?put/i],
  ["Lauf", /^(800|1000|1500|2000|3000|5000|10[,.]?000)\s*m|mile|steeple|\d+([.,]\d+)?\s*k(m|ilomet)|marathon|cross|\bxc\b|road/i],
  ["Sprint", /^(50|55|60|100|150|200|300|400|500)\s*m\b/i],
];
/** Bereich einer Disziplin im Programm (null = Jugend, Staffel oder unbekannt) */
export const eventArea = (e: string) => (NOT_SENIOR.test(e) ? null : AREA_EVENT.find(([, re]) => re.test(e.trim()))?.[0] ?? null);
/** Disziplinen für Erwachsene, die einem Bereich zugeordnet werden können */
export const seniorEvents = (events: string[]) => events.filter((e) => eventArea(e));
/** Laufdisziplinen ab 800 m */
export const runningEvents = (events: string[]) => events.filter((e) => eventArea(e) === "Lauf");

// Ohne Programm: Bereiche, die der Name verrät (z. B. „Hylo Javelin Meeting“ → Wurf); sonst unbekannt
const AREA_NAME: [string, RegExp][] = [
  ["Wurf", /throw|hammer|javelin|discus|shot ?put|wurf|kugel|speer/i],
  ["Sprung", /pole vault|jump|stabhoch|sprung|springen/i],
  ["Mehrkampf", /combined events|multi|decathlon|heptathlon|pentathlon|mehrkampf/i],
  ["Gehen", /race ?walk|walking|geher/i],
  ["Sprint", /\bsprint/i],
];
export const nameAreas = (name: string) => {
  const found = AREA_NAME.filter(([, re]) => re.test(name)).map(([a]) => a);
  return found.length ? found : null;
};
/** Bereiche eines Wettkampfs: aus dem Programm, sonst aus Art (Straße/Cross = Lauf) und Name; null = unbekannt (alle) */
export function calendarAreas(units: { events: string[] }[] | null, kinds: string[], name: string): string[] | null {
  const ORDER = ["Lauf", "Sprint", "Hürden", "Sprung", "Wurf", "Mehrkampf", "Gehen"];
  const set = new Set<string>();
  if (units) for (const u of units) for (const e of u.events) { const a = eventArea(e); if (a) set.add(a); }
  else {
    if (kinds.some((k) => k === "road" || k === "cross")) set.add("Lauf");
    const byName = nameAreas(name);
    if (byName) byName.forEach((a) => set.add(a));
    else if (kinds.includes("track")) return null;
  }
  return ORDER.filter((a) => set.has(a));
}

// Meisterschaften und Spiele anderer Kontinente bzw. Länder – dort starten keine Deutschen
export const OTHER_REGION = /\b(asian|african|africa|oceania|south american|pan[- ]?american|nacac|central american|caribbean|carifta|arab|gulf|commonwealth|bolivarian|francophonie|sea games|asean|mediterranean|island games|ibero-?american|balkan)\b/i;
export function irrelevantChampionship(e: { name: string; area?: string | null; country?: string | null; competitionGroup?: string | null }) {
  const text = `${e.name} ${e.competitionGroup ?? ""}`;
  if (OTHER_REGION.test(text)) return true;
  // Kontinentalmeisterschaften außerhalb Europas
  if (/\barea\b.*championships/i.test(e.competitionGroup ?? "") && e.area && e.area !== "Europe") return true;
  // nationale Meisterschaften anderer Länder
  if (/national.*championships|national championships/i.test(text) && e.country !== "GER") return true;
  return false;
}
