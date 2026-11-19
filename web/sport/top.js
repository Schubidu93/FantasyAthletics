// Top-Leistungen: einzelne Ergebnisse mit den meisten Punkten in einem Zeitraum (Standard: letzte 30 Tage), optional je Disziplin
import { html, useState } from '../vendor/preact-htm.js';
import { fmtDate, fmtPts, Loading, openRider, rpc, useLoad } from '../lib.js';
import { BackToAthlete, DiscFilter, discLabel, raceLabel, SexBadge } from './lib.js';

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PERIODS = [['7', 'Letzte 7 Tage'], ['30', 'Letzte 30 Tage'], ['year', 'Dieses Jahr'], ['custom', 'Eigener Zeitraum']];
function range(period, from, to) {
  if (period === 'year') return [`${new Date().getFullYear()}-01-01`, iso(new Date())];
  if (period === 'custom') return [from || '2025-01-01', to || iso(new Date())];
  return [daysAgo(Number(period) - 1), iso(new Date())];
}

// Auswahl bleibt beim Zurückkehren aus einem Athletenprofil erhalten
const saved = { period: '30', from: daysAgo(29), to: iso(new Date()), disc: '' };
const keep = (key, setter) => (v) => { saved[key] = v; setter(v); };

export function TopResults({ c }) {
  const [period, setPeriodRaw] = useState(saved.period);
  const [from, setFromRaw] = useState(saved.from);
  const [to, setToRaw] = useState(saved.to);
  const [disc, setDiscRaw] = useState(saved.disc);
  const setPeriod = keep('period', setPeriodRaw), setFrom = keep('from', setFromRaw), setTo = keep('to', setToRaw);
  const setDisc = keep('disc', setDiscRaw);
  const [a, b] = range(period, from, to);
  const list = useLoad(() => rpc('top_results', { p_gender: c.league.gender, p_from: a, p_to: b, p_discipline: disc || null, p_limit: 200 }),
    [c.league.gender, a, b, disc]);
  // nur Athleten, die es in dieser Liga gibt (Bereiche der Liga)
  const rows = (list.data || []).filter((r) => c.riderMap[r.athlete_id]).slice(0, 100);

  return html`<section class="card">
    <${BackToAthlete} />
    <h2>Top-Leistungen</h2>
    <p class="muted small">Die einzelnen Ergebnisse mit den meisten Punkten.</p>
    <div class="filters">
      <select value=${period} onChange=${(e) => setPeriod(e.target.value)} aria-label="Zeitraum">
        ${PERIODS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <${DiscFilter} value=${disc} onChange=${setDisc} />
      ${period === 'custom' && html`<label class="small">von <input type="date" value=${from} max=${to} onChange=${(e) => setFrom(e.target.value)} /></label>
        <label class="small">bis <input type="date" value=${to} min=${from} onChange=${(e) => setTo(e.target.value)} /></label>`}
    </div>
    ${!list.data ? html`<${Loading} error=${list.error} />` : rows.length === 0 ? html`<p class="muted">Keine Ergebnisse mit Punkten in diesem Zeitraum.</p>` : html`
      <ul class="list compact">${rows.map((r, i) => {
        const p = c.riderMap[r.athlete_id];
        const owner = c.managerMap[c.owner[r.athlete_id]];
        const bonus = [Number(r.pb_points) > 0 && 'PB', Number(r.record_points) > 0 && 'Rekord'].filter(Boolean).join(' + ');
        return html`<li key=${`${r.athlete_id}|${r.competition_id}|${r.discipline}|${r.race}|${i}`} class=${owner && owner.id === c.me?.id ? 'me' : ''}>
          <span><span class="res-place">${i + 1}.</span>${' '}
            <button type="button" class="linkish" onClick=${() => openRider(r.athlete_id)}>${p.name}</button>
            ${c.league.gender === 'mixed' && html` <${SexBadge} g=${p.gender} />`}
            <small class="muted"><br />${discLabel(r.discipline)}${r.race && r.race !== 'F' ? ` · ${raceLabel(r.race)}` : ''}${r.mark ? ` · ${r.mark}` : ''}${bonus ? ` · ${bonus}` : ''}
              <br />${fmtDate(r.result_date)} · ${r.competition || ''} · ${owner ? owner.team_name : 'frei'}</small></span>
          <span><strong>${fmtPts(r.points)}</strong></span></li>`;
      })}</ul>`}
  </section>`;
}
