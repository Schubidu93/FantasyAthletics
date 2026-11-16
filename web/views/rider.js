// Athleten-Fenster: Stammdaten, Toplisten und alle Ergebnisse (Lauf, Zeit, WA-Punkte, Fantasy-Punkte)
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { sb, q, all, rpc, waAthleteUrl, waResultUrl, flag, riderGroup, GROUP_LABEL, discLabel, discWithKm, raceLabel } from '../lib.js';

// Punkte im Athletenfenster mit zwei Nachkommastellen
const fmtPts = (n) => (Number(n) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Ergebnisse werden ab dieser Saison gespeichert
const FIRST_YEAR = 2025;

// „28.08.“ – das Jahr steht schon oben im Reiter
const shortDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : '');
const leagueId = () => (location.hash.match(/^#\/league\/([^/]+)/) || [])[1];

// Platz: gewerteter Platz (bei geteilten Finals kombiniert), Medaillen für 1–3 in Finals
function placeLabel(x) {
  if (!x.place) return x.remark ? html`<span class="muted">${x.remark}</span>` : '';
  const final = (x.race || 'F') === 'F';
  return final && x.place <= 3 ? html`<span class=${`medal m${x.place}`}>${x.place}.</span>` : `${x.place}.`;
}
// Zusatz zum Lauf: kombinierte Platzierung bzw. Wertung der Runde vor dem Finale
function runNote(x) {
  if (x.wa_race && x.wa_race !== x.race) return `${raceLabel(x.wa_race)}: ${x.wa_place ?? '–'}. · kombiniert`;
  if (x.placing_round && x.placing_round !== 'F') return x.placing_place === 0 ? 'fürs Finale qualifiziert (Q/q)' : `Gesamtplatz der Runde: ${x.placing_place}.`;
  return '';
}

async function loadRider(slug) {
  const [rider] = await q(sb.from('athletes').select('*').eq('id', slug));
  const rows = await all(() => sb.from('wa_results')
    .select('id,date,competition,discipline,category,race,place,wa_race,wa_place,placing_round,placing_place,mark,result_score,remark,wa_competition_id,wa_event_id,source,source_url')
    .eq('athlete_id', slug).gte('date', `${FIRST_YEAR}-01-01`).order('date', { ascending: false }).order('id'));
  const pts = Object.fromEntries((await all(() => sb.from('results').select('wa_result_id,points,perf_points,placing_points')
    .eq('athlete_id', slug).order('id'))).map((r) => [r.wa_result_id, r]));
  const toplists = await rpc('athlete_toplists', { p_athlete: slug });
  const season = Object.fromEntries((await q(sb.from('athlete_season_stats').select('year,season_rank,points,athletes').eq('athlete_id', slug)))
    .map((x) => [x.year, x]));
  const results = rows.map((r) => ({ ...r, pts: pts[r.id] || null }));
  return { rider, results, toplists, season };
}

export function RiderModal() {
  const [slug, setSlug] = useState(null);
  const [year, setYear] = useState(null);
  const [allRuns, setAllRuns] = useState(true);
  const [byPoints, setByPoints] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const open = (e) => { setSlug(e.detail); setData(null); setError(null); setYear(null); setByPoints(false); setAllRuns(true); };
    const esc = (e) => { if (e.key === 'Escape') setSlug(null); };
    addEventListener('rider:open', open);
    addEventListener('keydown', esc);
    return () => { removeEventListener('rider:open', open); removeEventListener('keydown', esc); };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    loadRider(slug).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
  }, [slug]);

  if (!slug) return null;
  const r = data?.rider;
  const yearOf = (x) => +x.date.slice(0, 4);
  const years = [...new Set((data?.results || []).map(yearOf))].sort();
  const thisYear = new Date().getFullYear();
  const y = year || (years.includes(thisYear) ? thisYear : years[years.length - 1]);
  const inYear = (data?.results || []).filter((x) => yearOf(x) === y);
  const total = inYear.reduce((s, x) => s + Number(x.pts?.points || 0), 0);
  const shown = (allRuns ? inYear : inYear.filter((x) => x.pts))
    .sort((a, b) => (byPoints ? Number(b.pts?.points ?? -1) - Number(a.pts?.points ?? -1) : 0) || b.date.localeCompare(a.date));
  const sr = data?.season?.[y];
  const g = riderGroup(r);
  const L = leagueId();
  const go = (x) => { if (!L || !x.wa_competition_id) return; setSlug(null); location.hash = `#/league/${L}/races/wa-c${x.wa_competition_id}`; };

  return html`<div class="modal-back" onClick=${() => setSlug(null)}>
    <div class="modal card" role="dialog" aria-modal="true" aria-label="Athlet" onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head">
        <div class="modal-title">
          <h2>${r?.nation ? flag(r.nation) + ' ' : ''}${r?.name || '…'}</h2>
          ${r && html`<a class="small" href=${waAthleteUrl(r)} target="_blank" rel="noopener">Profil bei World Athletics ↗</a>`}
          ${r && html`<div class="muted small">${[r.gender === 'women' ? 'Frauen' : 'Männer', g && (GROUP_LABEL[g] || g),
            r.birth_date && `Jg. ${r.birth_date.slice(0, 4)} (${Math.floor((Date.now() - new Date(r.birth_date)) / 31557600000)} J.)`].filter(Boolean).join(' · ')}</div>`}
          ${r && html`<div class="small"><strong>${r.pool_rank ? `Pool-Platz ${r.pool_rank}` : 'Nicht im aktuellen Pool'}</strong>${r.best_mark
            ? ` · Bestleistung ${discLabel(r.best_discipline)} ${r.best_mark} (${Math.round(r.ranking_points || 0)} WA-Punkte)` : ''}</div>`}
          ${y && html`<div class="small">${y}: ${fmtPts(total)} Punkte${sr ? ` · Platz ${sr.season_rank} von ${sr.athletes}` : ''}</div>`}
        </div>
        <button class="ghost small" onClick=${() => setSlug(null)} aria-label="Schließen">✕</button>
      </div>
      ${error ? html`<p class="note err">${error}</p>` : !data ? html`<p class="muted">Lädt …</p>` : html`
        <div class="row between">
          ${years.length > 1 ? html`<div class="seg small">${years.map((yy) =>
            html`<button class=${yy === y ? 'active' : ''} onClick=${() => setYear(yy)}>${yy}</button>`)}</div>` : html`<span class="muted small">${y || ''}</span>`}
          <div><span class="big">${fmtPts(total)}</span> <span class="muted small">Punkte${y ? ` ${y}` : ''}</span></div>
        </div>
        <div class="row between">
          <span class="muted small">Sortieren: „Datum“ oder „Pkt.“ antippen (orange = aktiv)</span>
          <label class="check small"><input type="checkbox" checked=${allRuns} onChange=${(e) => setAllRuns(e.target.checked)} /> auch ohne Punkte</label>
        </div>
        ${shown.length === 0 ? html`<p class="muted">Keine Ergebnisse${y ? ` in ${y}` : ''}${!allRuns ? ' mit Punkten' : ''}.</p>` : html`<div class="modal-body">
          <div class="res-row res-head">
            <button type="button" class=${`sort-head ${!byPoints ? 'active' : ''}`} onClick=${() => setByPoints(false)}>Datum</button>
            <span>Wettkampf · Lauf · Zeit</span><span class="res-place">Platz</span>
            <button type="button" class=${`sort-head res-pts ${byPoints ? 'active' : ''}`} onClick=${() => setByPoints(true)}>Pkt.</button></div>
          <div class="res-table">${shown.map((x) => html`<div key=${x.id} class=${`res-row ${L && x.wa_competition_id ? 'clickable' : ''}`} onClick=${() => go(x)}>
            <span class="res-date">${shortDate(x.date)}</span>
            <span class="res-what"><b>${discWithKm(x.discipline, x.competition)}${x.race && x.race !== 'F' ? ` · ${raceLabel(x.race)}` : ''} · ${x.mark || '–'}</b>
              <small>${x.competition}${x.category ? ` · ${x.category}` : ''}${x.result_score ? ` · ${x.result_score} WA-P.` : ''}</small>
              ${x.source === 'manual' && html`<small class="muted">Nachtrag${x.source_url ? html` · <a href=${x.source_url} target="_blank" rel="noopener"
                onClick=${(e) => e.stopPropagation()}>Quelle</a>` : ''}${!x.pts ? ' · zählt nicht (World Athletics führt das Ergebnis oder unter der Schwelle)' : ''}</small>`}
              ${runNote(x) && html`<small class="muted">${runNote(x)}</small>`}
              ${x.wa_competition_id && html`<small><a href=${waResultUrl(x.wa_competition_id, x.wa_event_id)} target="_blank" rel="noopener"
                onClick=${(e) => e.stopPropagation()}>WA-Ergebnis ↗</a></small>`}
              ${x.pts && html`<small class="muted">Leistung ${fmtPts(x.pts.perf_points)} + Platzierung ${fmtPts(x.pts.placing_points)}</small>`}</span>
            <span class="res-place">${placeLabel(x)}</span>
            <span class="res-pts">${x.pts ? fmtPts(x.pts.points) : ''}</span>
          </div>`)}</div>
        </div>`}
        ${data.toplists.length > 0 && html`<details class="toplists"><summary class="small">Toplisten (DE)</summary>
          <ul class="list compact">${data.toplists.map((t) => html`<li key=${t.year + t.discipline}>
            <span>${t.year} · ${discLabel(t.discipline)}</span><span class="muted"><strong>Platz ${t.rank}</strong> · ${t.mark} · ${t.score} WA-P.</span></li>`)}</ul></details>`}`}
      <p class="muted small">Quelle: World Athletics, Nachträge mit eigener Quelle. Antippen öffnet den Wettkampf.</p>
    </div>
  </div>`;
}
