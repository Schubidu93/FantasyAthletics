// Disziplingruppen (Schwerpunkt-Disziplinen) je Bereich und Zuordnung von Programm-Disziplinen aus dem WA-Kalender.
// Reine Daten und Funktionen ohne Oberfläche: genutzt von der App (über sport/lib.js) und vom Importer (calendar-filter.ts).

// Gruppen je Bereich – wie _group_area in der Datenbank
export const AREA_GROUPS = {
  Lauf: ['800', '1500', '5000', '10000', 'Marathon', 'Hindernis'],
  Sprint: ['100', '200', '400'],
  Hürden: ['Kurzhürden', 'Langhürden'],
  Sprung: ['Hochsprung', 'Stabhochsprung', 'Weitsprung', 'Dreisprung'],
  Wurf: ['Kugel', 'Diskus', 'Hammer', 'Speer'],
  Mehrkampf: ['Mehrkampf'],
  Gehen: ['Gehen'],
};
export const AREAS = Object.keys(AREA_GROUPS);
export const groupArea = (g) => AREAS.find((a) => AREA_GROUPS[a].includes(g)) || null;

// Programm im WA-Kalender („Events to be staged“): „100m“, „400mH“, „1500m“, „3000mSC“, „5 km Road“, „Long Jump“,
// „20 km Race Walk“ … → Gruppe (verwandte Strecken wie in der Wertung: 60 m → 100 m, Meile → 1500 m, 3000 m → 5000 m).
// Reihenfolge zählt (Gehen vor Lauf, Hürden vor Sprint).
const km = (e) => { const m = e.match(/(\d+(?:[.,]\d+)?)\s*k(?:m|ilomet)/i); return m ? parseFloat(m[1].replace(',', '.')) : null; };
const EVENT_GROUP = [
  [/walk|\bRW\b|gehen/i, () => 'Gehen'],
  [/^(300|400)\s*m\s*H\b|400\s*m(etres)?\s*hurdles/i, () => 'Langhürden'],
  [/^\d+\s*m\s*H\b|hurdles/i, () => 'Kurzhürden'],
  [/decathlon|heptathlon|pentathlon|combined/i, () => 'Mehrkampf'],
  [/high jump/i, () => 'Hochsprung'], [/pole vault/i, () => 'Stabhochsprung'],
  [/long jump/i, () => 'Weitsprung'], [/triple jump/i, () => 'Dreisprung'],
  [/shot ?put/i, () => 'Kugel'], [/discus/i, () => 'Diskus'], [/hammer/i, () => 'Hammer'], [/javelin/i, () => 'Speer'],
  [/steeple|\bSC\b|\dmSC/i, () => 'Hindernis'],
  [/half marathon/i, () => 'Marathon'], [/marathon/i, () => 'Marathon'],
  [/^(800|1000)\s*m/i, () => '800'], [/^(1500|2000)\s*m|mile/i, () => '1500'], [/^(3000|5000)\s*m/i, () => '5000'],
  [/^10[,.]?000\s*m/i, () => '10000'],
  // Straße/Cross nach Länge (ohne Angabe 10 km) – wie _result_group bzw. die Straßenwertung
  [/\d+([.,]\d+)?\s*k(m|ilomet)|cross|\bxc\b|road/i, (e) => { const k = km(e) ?? 10; return k <= 3 ? '1500' : k <= 6 ? '5000' : k <= 15 ? '10000' : 'Marathon'; }],
  [/^(50|55|60|100)\s*m\b/i, () => '100'], [/^(150|200)\s*m\b/i, () => '200'], [/^(300|400|500)\s*m\b/i, () => '400'],
];
/** Gruppe einer Programm-Disziplin (ohne Prüfung auf Jugend/Staffel) oder null */
export function eventGroup(e) {
  const s = String(e || '').trim();
  const hit = EVENT_GROUP.find(([re]) => re.test(s));
  return hit ? hit[1](s) : null;
}
