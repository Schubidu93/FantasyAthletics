// Sportart Leichtathletik: alles, worin sich Runner Fantasy von UCI Fantasy unterscheidet (Begriffe,
// Spaltennamen, Texte). Der übrige App-Code ist in beiden Apps gleich und liest diese Werte hier.
import { html } from './vendor/preact-htm.js';
import { SexBadge } from './lib.js';

export const SPORT = {
  app: 'Runner Fantasy', emoji: '🏃', source: 'World Athletics',
  // Begriffe in den gebrauchten Fällen: ein Athlet, einen Athleten, die Athleten, den Athleten (Dativ Plural), des Athleten
  one: 'Athlet', oneAcc: 'Athleten', many: 'Athleten', manyDat: 'Athleten', oneGen: 'Athleten',
  // Spaltennamen in der Datenbank
  pk: 'id',                   // Schlüssel der Personentabelle
  fk: 'athlete_id',           // Verweis darauf (Kader, Aufstellung, Ergebnisse …)
  add: 'add_athlete', drop: 'drop_athlete',          // Waiver-Anträge
  give: 'give_athletes', take: 'take_athletes',      // Tausch
  current: 'current_athlete',                        // Draft: aktuell versteigert
  comp: 'competition_id', pts: 'points',             // Ergebnisse
  pointsRpc: 'athlete_points',
  // Texte
  dataLine: 'Daten: World Athletics (Toplisten und Ergebnisse). Keine offizielle App von World Athletics.',
  resultsSchedule: 'Ergebnisse werden stündlich von 8 bis 23 Uhr abgerufen.',
};
/** Schlüssel einer Person (Athlet bzw. Fahrer) */
export const pid = (r) => r?.id;

/** Zeile unter dem Namen in Listen (Teampunkte): Sportart-Info und Zusatztext */
export const PersonLine = ({ r, sub }) => html`<${SexBadge} g=${r?.gender} /> ${sub}`;
