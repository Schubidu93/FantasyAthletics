// Kalender: Erkennen, welche Bereiche (Lauf, Sprint, Hürden, Sprung, Wurf, Mehrkampf, Gehen – wie die Liga-Bereiche) ein
// Wettkampf für Erwachsene anbietet – aus dem Programm oder ersatzweise aus dem Namen.

// Programm („Events to be staged“): „100m“, „400mH“, „1500m“, „3000mSC“, „5 km Road“, „Long Jump“, „20 km Race Walk“ …
// Jugend, Masters und Staffeln zählen nicht.
import { eventGroup, groupArea } from "../web/sport/groups.js";

export const NOT_SENIOR = /\bU\s?\d{2}\b|\b[MW]\s?\d{2}\b|4\s*x|relay|staffel|masters/i;
/** Bereich einer Disziplin im Programm (null = Jugend, Staffel oder unbekannt) */
export const eventArea = (e: string): string | null => (NOT_SENIOR.test(e) ? null : groupArea(eventGroup(e)));
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
