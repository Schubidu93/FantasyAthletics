// Sportart Leichtathletik: alles, worin sich Athletics Fantasy von UCI Fantasy unterscheidet (Begriffe,
// Spaltennamen, Texte). Der übrige App-Code ist in beiden Apps gleich und liest diese Werte hier.
import { html, useState } from '../vendor/preact-htm.js';
export * from './config.js';
import { SPORT, pid } from './config.js';
import './i18n-nl.js';   // niederländische Texte (Ligen in den Niederlanden)
import { normName, openRider } from '../lib.js';
import { discLabel, eligible, GROUP_LABEL, GroupFilter, groupFilterMatch, raceLabel, riderGroup, SexBadge } from './lib.js';

/** Darf in dieser Liga geholt werden (Waiver, Draft)? Im aktuellen Pool und in einem Bereich der Liga */
export const selectable = (r, league) => eligible(r, league);


/** Zeile unter dem Namen in Listen (Teampunkte): Sportart-Info und Zusatztext */
export const PersonLine = ({ r, sub }) => html`<${SexBadge} g=${r?.gender} /> ${sub}`;


/** Filter für Personenlisten (freie Athleten): Disziplin, in Mixed-Ligen auch Geschlecht. Liefert [Eingaben, Prüfung]. */
export function usePeopleFilter(c) {
  const [group, setGroup] = useState('');
  const [gender, setGender] = useState('');
  const ui = html`<${GroupFilter} league=${c.league} value=${group} onChange=${setGroup} />
      ${c.league.gender === 'mixed' && html`<select value=${gender} onChange=${(e) => setGender(e.target.value)}>
        <option value="">Männer und Frauen</option><option value="men">Männer</option><option value="women">Frauen</option></select>`}`;
  return [ui, (r) => groupFilterMatch(group, r) && (!gender || r.gender === gender)];
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

/** Name mit Kurzinfo (Gruppe/Jahrgang bzw. Nation/Team), antippen öffnet das Profil */
/** Zusatz zu einem Kader-Athleten in der Liga-Übersicht: Position in der Liga (Leichtathletik) */
export const RosterNote = ({ r }) => html`<span class="muted">${r?.pos_label || (r?.pos_wildcard ? 'Wildcard' : GROUP_LABEL[riderGroup(r)] || '')}</span>`;

export function RiderCell({ r, noRank }) {
  if (!r) return html`<span class="muted">unbekannt</span>`;
  const g = riderGroup(r);
  const meta = [g && (GROUP_LABEL[g] || g), r.birth_date && `Jg. ${r.birth_date.slice(0, 4)}`]
    .filter(Boolean).join(' · ');
  // beste Leistung der letzten 12 Monate
  const best = r.recent_mark && `${discLabel(r.recent_discipline)} ${r.recent_mark}${r.recent_score ? ` · ${r.recent_score} P.` : ''}`;
  return html`<span class="rider">
    <span class="rider-line">
      <span>${r.league_rank && !noRank
          ? html`<strong class="res-place" title="Platz unter den Athleten dieser Liga (nach Punkten im Vorjahr der Saison)">${r.league_rank}.</strong> ` : ''}<button type="button" class="rider-name linkish" title="Ergebnisse anzeigen"
        onClick=${(e) => { e.stopPropagation(); openRider(r.id); }}>${r.name}</button></span>
      ${r.pos_rank ? html`<span class="rank-chip" title="Platz unter den Athleten dieser Position der Liga (nach Punkten im Vorjahr der Saison)">#${r.pos_rank} ${r.pos_label}</span>`
        : r.pos_wildcard && html`<span class="rank-chip" title="Keine eigene Position in dieser Liga – nur auf einer Wildcard">nur Wildcard</span>`}
      ${r.inactive && html`<span class="tag warn">inaktiv</span>`}
    </span>
    <span class="rider-meta"><${SexBadge} g=${r.gender} />${meta ? ` ${meta}` : ''}</span>
    ${best && html`<span class="rider-team" title="Beste Leistung der letzten 12 Monate">${best}</span>`}
  </span>`;
}

/** Suchtext für die Personenauswahl (Name plus Disziplingruppe bzw. Team) */
export const searchText = (r) => normName(r.name + ' ' + (riderGroup(r) || ''));
