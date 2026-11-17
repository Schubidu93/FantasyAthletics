// Athleten-Übersicht: alle Athleten der Wertung mit Punkten der Saison und Besitzer in der Liga
import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { fmtPts, Loading, normName, rpc, rpcAll, useLoad } from '../lib.js';
import { GROUP_LABEL, GROUPS, riderGroup } from './lib.js';
import { rank, RiderCell } from './index.js';

export function Riders({ c }) {
  const years = useLoad(() => rpc('result_years'), []);
  const [sort, setSort] = useState(String(new Date().getFullYear()));   // Jahr oder 'rank'
  // Punkte des gewählten Jahres; bei Sortierung nach Pool-Rang die des laufenden Jahres
  // gewähltes Jahr noch ohne Ergebnisse (z. B. Jahresanfang) → neuestes Jahr mit Ergebnissen
  const ys = (years.data || []).map(String);
  // Pool-Rang = Reihenfolge nach den Punkten im Vorjahr des Spieljahrs → eigene Sortierung nur, wenn es dieses Jahr nicht gibt
  const gy = useLoad(() => rpc('game_year'), []);
  const showRank = !ys.includes(String((gy.data || new Date().getFullYear()) - 1));
  const sel0 = (sort === 'rank' && showRank) || (sort !== 'rank' && (!ys.length || ys.includes(sort))) ? sort : ys[0] || sort;
  const recent = sort === 'recent';
  const sel = recent ? 'recent' : sel0;
  const year = sel === 'rank' || recent ? +(ys[0] || new Date().getFullYear()) : +sel;
  const pts = useLoad(() => recent ? rpcAll('athlete_points_recent', { p_gender: c.league.gender, p_days: 30 })
    : rpcAll('athlete_points', { p_gender: c.league.gender, p_year: year }), [c.league.gender, year, recent]);
  // Heiße freie Athleten: die 10 freien mit den meisten Punkten der letzten 30 Tage (🔥 in der Liste)
  const hot = useLoad(() => rpcAll('athlete_points_recent', { p_gender: c.league.gender, p_days: 30 }), [c.league.gender]);
  const hotSet = useMemo(() => new Set((hot.data || []).filter((p) => !c.owner[p.athlete_id] && c.riderMap[p.athlete_id])
    .sort((a, b) => b.points - a.points).slice(0, 10).map((p) => p.athlete_id)), [hot.data]);
  const [term, setTerm] = useState('');
  const [group, setGroup] = useState('');
  const [gender, setGender] = useState('');
  const [owner, setOwner] = useState('');          // '' alle, 'free' frei, 'mine' meine, sonst Manager-ID
  const [limit, setLimit] = useState(100);

  const pmap = useMemo(() => Object.fromEntries((pts.data || []).map((p) => [p.athlete_id, p])), [pts.data]);
  if (!pts.data) return html`<${Loading} error=${pts.error} />`;

  const t = normName(term);
  const list = c.people
    .filter((r) => recent ? pmap[r.id] : r.pool_rank || pmap[r.id] || c.owner[r.id])   // 30 Tage: nur wer gepunktet hat
    .filter((r) => (!group || riderGroup(r) === group) && (!gender || r.gender === gender))
    .filter((r) => !owner || (owner === 'free' ? !c.owner[r.id] : owner === 'mine' ? c.owner[r.id] === c.me?.id : c.owner[r.id] === owner))
    .filter((r) => !t || t.split(' ').every((w) => normName(r.name).includes(w)))
    .sort((a, b) => sel === 'rank'
      ? (a.pool_rank ?? 1e9) - (b.pool_rank ?? 1e9)
      : (Number(pmap[b.id]?.points) || 0) - (Number(pmap[a.id]?.points) || 0) || (a.pool_rank ?? 1e9) - (b.pool_rank ?? 1e9));

  return html`<section class="card">
    <div class="row between"><h2>Athleten</h2><span class="muted small">${list.length} Athleten · Punkte ${recent ? 'letzte 30 Tage' : year}</span></div>
    ${c.league.status === 'active' && html`<div class="row"><button class=${`small ${recent && owner === 'free' ? 'primary' : ''}`}
      onClick=${() => { if (recent && owner === 'free') { setSort(String(new Date().getFullYear())); setOwner(''); } else { setSort('recent'); setOwner('free'); } setLimit(100); }}>
      🔥 Heiße freie Athleten</button>
      <span class="muted small">frei, meiste Punkte der letzten 30 Tage</span></div>`}
    <div class="filters">
      <input type="search" placeholder="Name" value=${term} onInput=${(e) => { setTerm(e.target.value); setLimit(100); }} />
      <select value=${group} onChange=${(e) => setGroup(e.target.value)}><option value="">Alle Disziplinen</option>${GROUPS.map((g) => html`<option value=${g}>${GROUP_LABEL[g]}</option>`)}</select>
      ${c.league.gender === 'mixed' && html`<select value=${gender} onChange=${(e) => setGender(e.target.value)}>
        <option value="">Männer und Frauen</option><option value="men">Männer</option><option value="women">Frauen</option></select>`}
      <select value=${owner} onChange=${(e) => setOwner(e.target.value)}>
        <option value="">Alle Athleten</option><option value="free">Nur freie</option>
        ${c.me && html`<option value="mine">Mein Kader</option>`}
        ${c.managers.filter((m) => m.id !== c.me?.id).map((m) => html`<option value=${m.id}>Kader ${m.team_name}</option>`)}
      </select>
      <select value=${sel} onChange=${(e) => setSort(e.target.value)}>
        ${(years.data?.length ? years.data : [year]).map((yy) => html`<option value=${String(yy)}>Sortiert nach Punkten ${yy}</option>`)}
        <option value="recent">Sortiert nach Punkten letzte 30 Tage</option>
        ${showRank && html`<option value="rank">Sortiert nach Pool-Rang</option>`}
      </select>
    </div>
    <div class="scroll-x"><table class="tbl people-tbl">
      <thead><tr><th class="num hide-sm col-no">#</th><th>Athlet</th><th class="col-owner">Kader</th><th class="num hide-sm col-res">Ergebnisse</th><th class="num col-pts" title=${recent ? 'Fantasy-Punkte der letzten 30 Tage' : `Fantasy-Punkte ${year}`}>Pkt.</th></tr></thead>
      <tbody>${list.slice(0, limit).map((r, i) => {
        const m = c.managerMap[c.owner[r.id]];
        const p = pmap[r.id];
        return html`<tr key=${r.id} class=${m && m.id === c.me?.id ? 'me' : ''}>
          <td class="num muted hide-sm">${i + 1}</td>
          <td><${RiderCell} r=${r} /></td>
          <td class="col-owner">${m ? m.team_name : html`<span class="tag ok">frei</span>${hotSet.has(r.id) ? html` <span title="Heiß: unter den 10 freien Athleten mit den meisten Punkten der letzten 30 Tage">🔥</span>` : ''}`}</td>
          <td class="num hide-sm">${p?.results || 0}</td>
          <td class="num"><strong>${fmtPts(p?.points)}</strong></td></tr>`;
      })}</tbody>
    </table></div>
    ${list.length > limit && html`<div class="row"><button onClick=${() => setLimit(limit + 200)}>Mehr anzeigen (${list.length - limit} weitere)</button></div>`}
    ${(pts.data || []).length === 0 && html`<p class="muted small">Noch keine Ergebnisse ${recent ? 'in den letzten 30 Tagen' : 'für dieses Jahr'} – Ergebnisse werden stündlich von 8 bis 23 Uhr abgerufen.</p>`}
  </section>`;
}
