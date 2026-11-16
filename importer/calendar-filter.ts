// Kalender: Erkennen, ob ein Wettkampf Laufdisziplinen ab 800 m für Erwachsene anbietet.

// Programm („Events to be staged“): „1500m“, „3000mSC“, „5 km Road“, „Half Marathon“ … – keine Jugend, keine Staffeln, kein Gehen
export const RUNNING_EVENT = /^(800|1000|1500|2000|3000|5000|10[,.]?000)\s*m|mile|steeple|\d+([.,]\d+)?\s*k(m|ilomet)|marathon|cross|\bxc\b|road/i;
export const NOT_SENIOR = /\bU\s?\d{2}\b|\b[MW]\s?\d{2}\b|4\s*x|relay|staffel|walk|geh/i;
export const runningEvents = (events: string[]) => events.filter((e) => RUNNING_EVENT.test(e.trim()) && !NOT_SENIOR.test(e));

// Ohne Programm: Wettkämpfe, die dem Namen nach keine Laufdisziplinen haben
export const NOT_RUNNING = /pole vault|jump|throw|hammer|javelin|discus|shot ?put|combined events|multi|decathlon|heptathlon|pentathlon|race ?walk|walking|sprint|stabhoch|sprung|wurf|mehrkampf|geher|kugel|speer/i;

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
