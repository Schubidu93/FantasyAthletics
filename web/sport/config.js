// Sportart Leichtathletik: alles, worin sich Athletics Fantasy von UCI Fantasy unterscheidet (Begriffe,
// Texte). Die Datenbank-Namen sind in beiden Apps gleich (athletes, athlete_id, competitions …).
// Der übrige App-Code ist in beiden Apps gleich und liest diese Werte hier.
// Reine Daten ohne Abhängigkeiten – auch von web/lib.js genutzt.

export const SPORT = {
  app: 'Athletics Fantasy', emoji: '🏃', source: 'World Athletics',
  // Begriffe in den gebrauchten Fällen: ein Athlet, einen Athleten, die Athleten, den Athleten (Dativ Plural), des Athleten
  one: 'Athlet', oneAcc: 'Athleten', many: 'Athleten', manyDat: 'Athleten', oneGen: 'Athleten',
  pointsWord: 'Punkten',                       // „Sortiert nach …“
  ptsFormat: { minimumFractionDigits: 2, maximumFractionDigits: 2 },   // Anzeige der Punkte
  // Texte
  dataLine: 'Daten: World Athletics (Toplisten und Ergebnisse). Keine offizielle App von World Athletics.',
  matchdayExamples: 'alle 2 Wochen oder Hallensaison, Frühjahr, Bahnsaison',   // Beispiele für Spieltage
  fallbackBasis: 'den WA-Punkten der Toplisten', fallbackShort: 'WA',   // Draft-Report ohne Vorjahrespunkte
  rankingOption: 'nach WA-Punkten (beste zuerst)', rankingPhrase: 'nach WA-Punkten',   // Draft-Reihenfolge
  bestBy: 'nach WA-Punkten', orderLabel: 'nach WA-Punkten',   // Draft: automatische Wahl, Reihenfolge
  csvNameHint: 'Name wie bei World Athletics, z. B. „Robert FARKEN“', inPoolWord: 'im Pool',   // Offline-Draft (CSV)
  resultsSchedule: 'Ergebnisse werden stündlich von 8 bis 23 Uhr abgerufen.',
  // Sprache der Oberfläche je Liga (Wörterbuch in i18n-nl.js); ohne Angabe Deutsch
  uiLang: (league) => (league?.nation === 'NED' ? 'nl' : 'de'),
};
/** Schlüssel einer Person (Athlet bzw. Fahrer) */
export const pid = (r) => r?.id;

/** Platz der Person in der Auswahl (Pool-Rang) – für Sortierungen */
export const rank = (r) => r?.pool_rank;
