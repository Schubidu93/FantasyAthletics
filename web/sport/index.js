// Sportart Leichtathletik: alles, worin sich Runner Fantasy von UCI Fantasy unterscheidet (Begriffe,
// Spaltennamen, Texte). Der übrige App-Code ist in beiden Apps gleich und liest diese Werte hier.
import { html, useState } from '../vendor/preact-htm.js';
import { SexBadge, GROUPS, GROUP_LABEL, riderGroup, discLabel, raceLabel } from '../lib.js';

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
  pointsWord: 'Punkten',                       // „Sortiert nach …“
  pointsRpc: 'athlete_points',
  // Texte
  dataLine: 'Daten: World Athletics (Toplisten und Ergebnisse). Keine offizielle App von World Athletics.',
  matchdayExamples: 'alle 2 Wochen oder Hallensaison, Frühjahr, Bahnsaison',   // Beispiele für Spieltage
  fallbackBasis: 'den WA-Punkten der Toplisten', fallbackShort: 'WA',   // Draft-Report ohne Vorjahrespunkte
  rankingOption: 'nach WA-Punkten (beste zuerst)', rankingPhrase: 'nach WA-Punkten',   // Draft-Reihenfolge
  resultsSchedule: 'Ergebnisse werden stündlich von 8 bis 23 Uhr abgerufen.',
};
/** Schlüssel einer Person (Athlet bzw. Fahrer) */
export const pid = (r) => r?.id;

/** Zeile unter dem Namen in Listen (Teampunkte): Sportart-Info und Zusatztext */
export const PersonLine = ({ r, sub }) => html`<${SexBadge} g=${r?.gender} /> ${sub}`;

/** Platz der Person in der Auswahl (Pool-Rang) – für Sortierungen */
export const rank = (r) => r?.pool_rank;
/** Darf geholt werden (Waiver, Draft): nur Athleten im aktuellen Pool */
export const selectable = (r) => r?.pool_rank != null;

/** Filter für Personenlisten (freie Athleten): Disziplin, in Mixed-Ligen auch Geschlecht. Liefert [Eingaben, Prüfung]. */
export function usePeopleFilter(c) {
  const [group, setGroup] = useState('');
  const [gender, setGender] = useState('');
  const ui = html`<select value=${group} onChange=${(e) => setGroup(e.target.value)}><option value="">Alle Disziplinen</option>${GROUPS.map((g) => html`<option value=${g}>${GROUP_LABEL[g]}</option>`)}</select>
      ${c.league.gender === 'mixed' && html`<select value=${gender} onChange=${(e) => setGender(e.target.value)}>
        <option value="">Männer und Frauen</option><option value="men">Männer</option><option value="women">Frauen</option></select>`}`;
  return [ui, (r) => (!group || riderGroup(r) === group) && (!gender || r.gender === gender)];
}

// Bezeichnung eines gewerteten Ergebnisses: "1500 Metres · SF1" → "1500 m · Halbfinale 1"
export const labelText = (l) => {
  if (!l) return 'Ergebnis';
  const parts = l.split(' · ');
  const km = parts.find((x) => /^[\d.]+km$/.test(x));
  const run = parts.slice(1).find((x) => x !== km);
  const disc = discLabel(parts[0]) + (km ? ` ${Number(km.slice(0, -2)).toLocaleString('de-DE')} km` : '');
  return run ? `${disc} · ${raceLabel(run)}` : disc;
};
