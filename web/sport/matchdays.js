// Spieltag-Vorschläge der Leichtathletik: Meisterschaften (aus dem WA-Kalender bzw. der DLV-Terminliste) bekommen
// eigene Spieltage; Großereignisse werden nicht auf zwei Spieltage verteilt. Alles hängt von den Bereichen der Liga ab
// (z. B. Cross-EM nur in reinen Laufligen, ohne Lauf keine leeren Herbst- und Wintermonate).
import { html } from '../vendor/preact-htm.js';
import { proposal } from '../views/admin/proposal.js';
import { fmtDate, q, sb, useLoad } from '../lib.js';
import { leagueAreas } from './lib.js';
import { championshipLabel, missingChampionships, monthlyProposal, seasonProposal, withChampionshipMatchdays, withExtraChampionships } from './matchday-plan.js';


export const EMPTY_HINT = 'Noch keine Spieltage. Am schnellsten: unten „Spieltage automatisch vorschlagen“ → „Alle 2 Wochen“ oder „Saisonblöcke“ → „Alle anlegen“.';
export const NAME_PLACEHOLDER = 'z. B. Hallensaison';

/** Knöpfe und Hinweise für „Spieltage automatisch vorschlagen“ (Admin → Spieltage) */
export function MatchdayProposals({ c, setGen }) {
  const areas = leagueAreas(c.league);
  // Großereignisse aus dem Kalender, die nicht auf zwei Spieltage verteilt werden sollen – nur mit Disziplinen der Liga
  const big = useLoad(async () => (await q(sb.from('calendar_events').select('name,category,country,start_date,end_date,areas')
    .gte('end_date', c.league.season_start).lte('start_date', c.league.season_end)))
    .filter((e) => !e.areas || e.areas.some((a) => areas.includes(a)))
    .filter((e) => ['OW', 'DF', 'GW', 'GL'].includes(e.category) || championshipLabel(e, areas)), [c.league.id]);
  const extra = useLoad(async () => await q(sb.from('extra_calendar_events').select('name,start_date,end_date,source_url')
    .gte('start_date', c.league.season_start).lte('start_date', c.league.season_end)), [c.league.id]);
  const events = withExtraChampionships(big.data || [], extra.data || []);
  const missing = missingChampionships(c.league.season_start, c.league.season_end, events);
  return html`<div class="row">
        <button class="primary" onClick=${() => setGen(monthlyProposal(c.league.season_start, c.league.season_end, events, areas))}>Monatlich (Mo–So)</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(proposal('biweekly', c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events, { renumber: 'Spieltag', areas }))}>Alle 2 Wochen</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(seasonProposal(c.league.season_start, c.league.season_end, areas), c.league.season_start, c.league.season_end, events, { areas }))}>Saisonblöcke</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(proposal('monthly', c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events, { areas }))}>Kalendermonate</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(proposal('weekly', c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events, { onlyIfSplit: true, renumber: 'Woche', areas }))}>Wöchentlich</button>
      </div>
      <p class="muted small">Empfohlen: „Monatlich (Mo–So)“ – Olympia, WM, EM, Hallen-WM/-EM, DM und Hallen-DM
        ${areas.length === 1 && areas[0] === 'Lauf' ? '(in reinen Laufligen auch Cross- und Straßen-WM/-EM) ' : ''}${areas.length === 1 && areas[0] === 'Wurf' ? '(dazu die Winterwurf-DM) ' : ''}${areas.length === 1 && areas[0] === 'Mehrkampf' ? '(dazu die Mehrkampf-DM) ' : ''}bekommen eigene Spieltage
        (Montag bis Sonntag der Meisterschaftswoche), dazwischen Spieltage von etwa einem Monat (Montag bis Sonntag).
        ${!areas.includes('Lauf') ? 'Ohne Lauf ruht die Saison ab Oktober – dafür gibt es einen Spieltag „Saisonpause“. ' : ''}
        Andere Großereignisse werden nicht geteilt. Auch bei den anderen Vorschlägen bekommen diese Meisterschaften einen eigenen Spieltag
        (bei „Wöchentlich“ nur, wenn sie sonst auf zwei Wochen fielen). Stehen DM oder Hallen-DM noch nicht im WA-Kalender, gilt der Termin aus der DLV-Terminliste.</p>
      ${events.some((e) => e.extra) && html`<p class="muted small">Aus der DLV-Terminliste (noch nicht bei WA):
        ${events.filter((e) => e.extra).map((e, i) => html`${i ? ', ' : ''}<a href=${e.source_url} target="_blank" rel="noopener">${championshipLabel(e)} ${fmtDate(e.start_date)}</a>`)}</p>`}
      ${big.data && extra.data && missing.length > 0 && html`<p class="muted small">Termin noch unbekannt: ${missing.join(', ')} – Claude kann ihn einmalig beim DLV nachschlagen und eintragen.</p>`}`;
}
