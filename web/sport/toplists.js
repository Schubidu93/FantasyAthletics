// Toplisten (DE) von World Athletics: Jahr, Disziplin und Geschlecht wählen, die besten 20 sehen
import { html } from '../vendor/preact-htm.js';
import { flag, Loading, openRider, q, rpc, sb, useLoad } from '../lib.js';
import { BackToAthlete, discLabel, discSections, leagueAreas, nationText, SexBadge } from './lib.js';

export function Toplists({ c, sub, sub2, sub3 }) {
  const idx = useLoad(() => rpc('toplist_index', { p_nation: c.league.nation || 'GER' }), []);
  const dis = useLoad(() => q(sb.from('disciplines').select('name,event_group')), []);
  const groupOf = Object.fromEntries((dis.data || []).map((d) => [d.name, d.event_group]));
  const rows = idx.data || [];
  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  const year = years.includes(+sub) ? +sub : years[0];
  const genders = c.league.gender === 'mixed' ? ['men', 'women'] : [c.league.gender];
  const gender = genders.includes(sub3) ? sub3 : genders[0];
  const sections = discSections(rows.filter((r) => r.year === year && r.gender === gender).map((r) => r.discipline),
    groupOf, leagueAreas(c.league));
  const discs = sections.flatMap((x) => x.discs);
  const disc = discs.includes(sub2 && decodeURIComponent(sub2)) ? decodeURIComponent(sub2) : discs[0];
  const list = useLoad(() => (year && disc ? rpc('toplist', { p_year: year, p_discipline: disc, p_gender: gender, p_limit: 20, p_nation: c.league.nation || 'GER' }) : Promise.resolve([])),
    [year, disc, gender]);
  const go = (y, d, g) => { location.hash = `#/league/${c.league.id}/toplists/${y}/${encodeURIComponent(d || '')}/${g}`; };
  if (!idx.data || !dis.data) return html`<${Loading} error=${idx.error || dis.error} />`;
  const owner = (id) => c.managerMap[c.owner[id]];

  return html`<section class="card">
    <${BackToAthlete} />
    <h2>Toplisten</h2>
    <p class="muted small">Bestenliste ${nationText(c.league.nation).name} von World Athletics – die besten 20 je Disziplin.</p>
    ${!years.length ? html`<p class="muted">Noch keine Toplisten geladen.</p>` : html`
      <div class="filters">
        <select value=${year} onChange=${(e) => go(e.target.value, disc, gender)} aria-label="Jahr">
          ${years.map((y) => html`<option value=${y}>${y}</option>`)}</select>
        ${genders.length > 1 && html`<select value=${gender} onChange=${(e) => go(year, disc, e.target.value)} aria-label="Geschlecht">
          <option value="men">Männer</option><option value="women">Frauen</option></select>`}
        <select value=${disc} onChange=${(e) => go(year, e.target.value, gender)} aria-label="Disziplin">
          ${sections.map((x) => html`<optgroup label=${x.area}>${x.discs.map((d) => html`<option value=${d}>${discLabel(d)}</option>`)}</optgroup>`)}</select>
      </div>
      ${!list.data ? html`<${Loading} error=${list.error} />` : list.data.length === 0 ? html`<p class="muted">Keine Einträge.</p>` : html`
        <h3 class="cal-month">${discLabel(disc)} <${SexBadge} g=${gender} /> ${year}</h3>
        <ul class="list compact">${list.data.map((t) => html`<li key=${t.athlete_id} class="clickable" onClick=${() => openRider(t.athlete_id)}>
          <span><span class="res-place">${t.rank}.</span> ${t.nation ? flag(t.nation) + ' ' : ''}<strong>${t.name}</strong>
            ${owner(t.athlete_id) && html`<small class="muted"> · ${owner(t.athlete_id).team_name}</small>`}</span>
          <span>${t.mark}</span></li>`)}</ul>`}`}
  </section>`;
}
