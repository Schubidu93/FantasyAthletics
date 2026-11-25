// Spieltag-Vorschläge der Leichtathletik: Meisterschaften (aus dem WA-Kalender bzw. der Terminliste des Verbands) bekommen
// eigene Spieltage; Großereignisse werden nicht auf zwei Spieltage verteilt. Alles hängt von den Bereichen der Liga ab
// (z. B. Cross-EM nur in reinen Laufligen, ohne Lauf keine leeren Herbst- und Wintermonate).
import { html } from '../vendor/preact-htm.js';
import { proposal } from '../views/admin/proposal.js';
import { fmtDate, q, sb, tr, useLoad } from '../lib.js';
import { leagueAreas } from './lib.js';
import { championshipLabel, missingChampionships, monthlyProposal, national, seasonProposal, withChampionshipMatchdays, withExtraChampionships } from './matchday-plan.js';


export const EMPTY_HINT = 'Noch keine Spieltage. Am schnellsten: unten „Spieltage automatisch vorschlagen“ → „Alle 2 Wochen“ oder „Saisonblöcke“ → „Alle anlegen“.';
export const NAME_PLACEHOLDER = 'z. B. Hallensaison';

/** Knöpfe und Hinweise für „Spieltage automatisch vorschlagen“ (Admin → Spieltage) */
// Namen der vorgeschlagenen Spieltage in der Sprache der Liga speichern („Mai“ → „Mei“ in niederländischen Ligen)
const named = (list) => list.map((m) => { const n = tr(m.name); return { ...m, name: n[0].toUpperCase() + n.slice(1) }; });

/** Knöpfe und Hinweise für „Spieltage automatisch vorschlagen“ (Admin → Spieltage) */
export function MatchdayProposals({ c, setGen }) {
  const areas = leagueAreas(c.league);
  const nation = c.league.nation || 'GER';
  const n = national(nation);
  // Großereignisse aus dem Kalender, die nicht auf zwei Spieltage verteilt werden sollen – nur mit Disziplinen der Liga
  const big = useLoad(async () => (await q(sb.from('calendar_events').select('name,category,country,start_date,end_date,areas')
    .gte('end_date', c.league.season_start).lte('start_date', c.league.season_end)))
    .filter((e) => !e.areas || e.areas.some((a) => areas.includes(a)))
    .filter((e) => ['OW', 'DF', 'GW', 'GL'].includes(e.category) || championshipLabel(e, areas, nation)), [c.league.id]);
  const extra = useLoad(async () => await q(sb.from('extra_calendar_events').select('name,start_date,end_date,source_url').eq('nation', nation)
    .gte('start_date', c.league.season_start).lte('start_date', c.league.season_end)), [c.league.id]);
  const events = withExtraChampionships(big.data || [], extra.data || [], nation);
  const missing = missingChampionships(c.league.season_start, c.league.season_end, events, nation);
  const s = c.league.season_start, e = c.league.season_end;
  const gen = (list) => setGen(named(list));
  return html`<div class="row">
        <button class="primary" onClick=${() => gen(monthlyProposal(s, e, events, areas, nation))}>Monatlich (Mo–So)</button>
        <button onClick=${() => gen(withChampionshipMatchdays(proposal('biweekly', s, e), s, e, events, { renumber: 'Spieltag', areas, nation }))}>Alle 2 Wochen</button>
        <button onClick=${() => gen(withChampionshipMatchdays(seasonProposal(s, e, areas), s, e, events, { areas, nation }))}>Saisonblöcke</button>
        <button onClick=${() => gen(withChampionshipMatchdays(proposal('monthly', s, e), s, e, events, { areas, nation }))}>Kalendermonate</button>
        <button onClick=${() => gen(withChampionshipMatchdays(proposal('weekly', s, e), s, e, events, { onlyIfSplit: true, renumber: 'Woche', areas, nation }))}>Wöchentlich</button>
      </div>
      <p class="muted small">Empfohlen: „Monatlich (Mo–So)“ – Olympia, WM, EM, Hallen-WM/-EM, ${n.main} und ${n.indoor}
        ${areas.length === 1 && areas[0] === 'Lauf' ? '(in reinen Laufligen auch Cross- und Straßen-WM/-EM) ' : ''}${areas.length === 1 && areas[0] === 'Wurf' ? `(dazu ${n.throw}) ` : ''}${areas.length === 1 && areas[0] === 'Mehrkampf' ? `(dazu ${n.ce}) ` : ''}bekommen eigene Spieltage
        (Montag bis Sonntag der Meisterschaftswoche), dazwischen Spieltage von etwa einem Monat (Montag bis Sonntag).
        ${!areas.includes('Lauf') ? 'Ohne Lauf ruht die Saison ab Oktober – dafür gibt es einen Spieltag „Saisonpause“. ' : ''}
        Andere Großereignisse werden nicht geteilt. Auch bei den anderen Vorschlägen bekommen diese Meisterschaften einen eigenen Spieltag
        (bei „Wöchentlich“ nur, wenn sie sonst auf zwei Wochen fielen). Stehen ${n.main} oder ${n.indoor} noch nicht im WA-Kalender, gilt der Termin aus der Terminliste des Verbands (${n.fed}).</p>
      ${events.some((x) => x.extra) && html`<p class="muted small">Aus der Terminliste des Verbands (${n.fed}, noch nicht bei WA):
        ${events.filter((x) => x.extra).map((x, i) => html`${i ? ', ' : ''}<a href=${x.source_url} target="_blank" rel="noopener">${championshipLabel(x, null, nation)} ${fmtDate(x.start_date)}</a>`)}</p>`}
      ${big.data && extra.data && missing.length > 0 && html`<p class="muted small">Termin noch unbekannt: ${missing.join(', ')} – Claude kann ihn einmalig beim Verband (${n.fed}) nachschlagen und eintragen.</p>`}`;
}
