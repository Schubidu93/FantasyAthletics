// Athleten-Fenster: Stammdaten, Toplisten und alle Ergebnisse (Lauf, Zeit, WA-Punkte, Fantasy-Punkte)
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { sb, q, all, rpc, waAthleteUrl, waResultUrl, flag, riderGroup, GROUP_LABEL, discLabel, discWithKm, raceLabel,
  fmtPts, CatBadge, discMeters, SexBadge, RELAYS, rememberAthlete } from '../lib.js';

// Ergebnisse werden ab dieser Saison gespeichert
const FIRST_YEAR = 2025;

// „28.08.“ – das Jahr steht schon oben im Reiter
const shortDate = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : '');
const leagueId = () => (location.hash.match(/^#\/league\/([^/]+)/) || [])[1];

// Platz: gewerteter Platz (bei geteilten Finals kombiniert), Medaillen für 1–3 in Finals
// Meisterschaft im offenen Rennen: Meisterschaftsplatz zählt, Platz im Gesamtfeld klein darunter
function placeLabel(x) {
  const p = x.champ_place || x.place;
  if (!p) return x.remark ? html`<span class="muted">${x.remark}</span>` : '';
  const final = (x.race || 'F') === 'F';
  const main = final && p <= 3 ? html`<span class=${`medal m${p}`}>${p}.</span>` : `${p}.`;
  return x.champ_place && x.place && x.place !== x.champ_place
    ? html`${main}<small class="muted place-sub">${x.place}. ges.</small>` : main;
}
// Sieg bei einer Meisterschaft (eigene Wertung im offenen Rennen oder Finale eines Meisterschafts-Wettkampfs)
const isTitle = (x) => x.champ_place === 1
  || (!x.champ_place && x.place === 1 && (x.race || 'F') === 'F' && /championships?\b|\bCh\.|meisterschaft/i.test(x.competition || '')
      && !/split time/i.test(x.competition || '') && x.remark !== 'ST');
// Zusatz zum Lauf: kombinierte Platzierung bzw. Wertung der Runde vor dem Finale
// Wettkampf kurz: Name vor dem ersten Komma, dazu der Ort (letzter Teil), wenn er nicht schon im Namen steht
function compShort(c) {
  const [main, ...rest] = String(c || '').replace(/\s+-\s+[^,]*$/, '').split(', ');
  const city = rest.length ? rest[rest.length - 1].replace(/\s*\(i\)\s*$/, '') : '';
  return city && !main.includes(city) ? `${main} · ${city}` : main;
}
// „18.07.26“
const dateShort = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}` : '');
const isSplit = (x) => /split time/i.test(x.competition || '') || x.remark === 'ST';
const RECORD = { DR: 'Deutscher Rekord', ER: 'Europarekord', WR: 'Weltrekord',
  '=DR': 'Deutscher Rekord eingestellt', '=ER': 'Europarekord eingestellt', '=WR': 'Weltrekord eingestellt' };
function runNote(x) {
  if (isSplit(x)) return 'Zwischenzeit – gibt nur bei einem Rekord Punkte';
  if (x.wa_race && x.wa_race !== x.race) return `${raceLabel(x.wa_race)}: ${x.wa_place ?? '–'}. · kombiniert`;
  if (x.placing_round && x.placing_round !== 'F') return x.placing_place === 0 ? 'fürs Finale qualifiziert (Q/q)' : `Gesamtplatz der Runde: ${x.placing_place}.`;
  return '';
}

async function loadRider(slug, league) {
  const [rider] = await q(sb.from('athletes').select('*').eq('id', slug));
  // Mixed-Liga: Platz in der Saisonwertung über Männer und Frauen hinweg
  const lg = league ? (await q(sb.from('leagues').select('gender,admin_user').eq('id', league)))[0] : null;
  const mixed = lg?.gender === 'mixed';
  // Liga-Admins dürfen Rekorde an Ergebnissen eintragen
  const admin = !!lg && lg.admin_user === (await sb.auth.getUser()).data?.user?.id;
  const rows = await all(() => sb.from('wa_results')
    .select('id,date,competition,discipline,category,race,place,wa_race,wa_place,placing_round,placing_place,mark,result_score,remark,wa_competition_id,wa_event_id,source,source_url,country,record,relay,champ_place,champ_category')
    .eq('athlete_id', slug).gte('date', `${FIRST_YEAR}-01-01`).order('date', { ascending: false }).order('id'));
  const pts = Object.fromEntries((await all(() => sb.from('results').select('wa_result_id,points,perf_points,placing_points,record_points,pb_points')
    .eq('athlete_id', slug).order('id'))).map((r) => [r.wa_result_id, r]));
  const toplists = await rpc('athlete_toplists', { p_athlete: slug });
  const pbs = (await q(sb.from('athlete_pbs').select('discipline,mark,date,result_score').eq('athlete_id', slug)))
    .sort((a, b) => discMeters(discLabel(a.discipline)) - discMeters(discLabel(b.discipline)) || a.discipline.localeCompare(b.discipline));
  const season = Object.fromEntries((await q(sb.from('athlete_season_stats').select('year,season_rank,points,athletes,overall_rank,overall_athletes').eq('athlete_id', slug)))
    .map((x) => [x.year, mixed && x.overall_rank ? { ...x, season_rank: x.overall_rank, athletes: x.overall_athletes } : x]));
  // voller PB-Bonus (zum Erkennen von =PB, das halb zählt)
  const pbFull = Number((await q(sb.from('scoring_config').select('pb_points').eq('id', 1)))[0]?.pb_points ?? 10);
  const results = rows.map((r) => ({ ...r, pts: pts[r.id] || null, pbFull }));
  return { rider, results, toplists, season, admin, pbs };
}

export function RiderModal() {
  const [slug, setSlug] = useState(null);
  const [year, setYear] = useState(null);
  const [allRuns, setAllRuns] = useState(true);
  const [disc, setDisc] = useState('');
  const [editRec, setEditRec] = useState(false);   // Admin: Rekorde von Hand eintragen
  const [byPoints, setByPoints] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const open = (e) => { setSlug(e.detail); setData(null); setError(null); setYear(null); setByPoints(false); setAllRuns(true); setDisc(''); setEditRec(false); };
    const esc = (e) => { if (e.key === 'Escape') setSlug(null); };
    addEventListener('rider:open', open);
    addEventListener('keydown', esc);
    return () => { removeEventListener('rider:open', open); removeEventListener('keydown', esc); };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    loadRider(slug, leagueId()).then((d) => alive && setData(d)).catch((e) => alive && setError(e.message));
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
  const dl = (x) => discWithKm(x.discipline, x.competition);
  const discs = [...new Set(inYear.map(dl))].sort((a, b) => discMeters(a) - discMeters(b) || a.localeCompare(b));
  const d = discs.includes(disc) ? disc : '';
  const inDisc = d ? inYear.filter((x) => dl(x) === d) : inYear;
  const discTotal = inDisc.reduce((s, x) => s + Number(x.pts?.points || 0), 0);
  const shown = (allRuns ? inDisc : inDisc.filter((x) => x.pts))
    .sort((a, b) => (byPoints ? Number(b.pts?.points ?? -1) - Number(a.pts?.points ?? -1) : 0) || b.date.localeCompare(a.date));
  const sr = data?.season?.[y];
  const g = riderGroup(r);
  const L = leagueId();
  const setRecord = async (x, v) => {
    try { await rpc('set_result_record', { p_id: x.id, p_record: v || null }); setData(await loadRider(slug, L)); }
    catch (e) { setError(e.message); }
  };
  // Meisterschaft im offenen Rennen (z. B. DM im Frankfurt-Marathon): Platz in der Meisterschaftswertung, Kategorie B
  const setChamp = async (x, v) => {
    try { await rpc('set_result_champ', { p_id: x.id, p_place: v === '' ? null : +v, p_category: 'B' }); setData(await loadRider(slug, L)); }
    catch (e) { setError(e.message); }
  };
  const toTop = (t) => { if (!L) return; rememberAthlete(slug, r?.name || ''); setSlug(null); location.hash = `#/league/${L}/toplists/${t.year}/${encodeURIComponent(t.discipline)}/${r?.gender || 'men'}`; };
  const go = (x) => { if (!L || !x.wa_competition_id) return; rememberAthlete(slug, r?.name || ''); setSlug(null); location.hash = `#/league/${L}/races/wa-c${x.wa_competition_id}`; };

  return html`<div class="modal-back" onClick=${() => setSlug(null)}>
    <div class="modal card" role="dialog" aria-modal="true" aria-label="Athlet" onClick=${(e) => e.stopPropagation()}>
      <div class="modal-head">
        <div class="modal-title">
          <h2>${r?.nation ? flag(r.nation) + ' ' : ''}${r?.name || '…'}</h2>
          ${r && html`<a class="small" href=${waAthleteUrl(r)} target="_blank" rel="noopener">WA-Profil ↗</a>`}
          ${r && html`<div class="muted small"><${SexBadge} g=${r.gender} /> ${[g && (GROUP_LABEL[g] || g),
            r.birth_date && `Jg. ${r.birth_date.slice(0, 4)} (${Math.floor((Date.now() - new Date(r.birth_date)) / 31557600000)} J.)`].filter(Boolean).join(' · ')}</div>`}
          ${r && html`<div class="small"><strong>${r.pool_rank ? `Pool-Platz ${r.pool_rank}` : 'Nicht im aktuellen Pool'}</strong>${r.best_mark
            ? ` · Bestleistung ${discLabel(r.best_discipline)} ${r.best_mark} (${Math.round(r.ranking_points || 0)} WA-Punkte)` : ''}</div>`}
          ${y && html`<div class="small">${y}: ${fmtPts(total)} Punkte${sr ? ` · Platz ${sr.season_rank}` : ''}</div>`}
        </div>
        <button class="ghost small" onClick=${() => setSlug(null)} aria-label="Schließen">✕</button>
      </div>
      ${error ? html`<p class="note err">${error}</p>` : !data ? html`<p class="muted">Lädt …</p>` : html`
        ${data.pbs.length > 0 && html`<details class="toplists"><summary class="small">Bestleistungen (${data.pbs.length})</summary>
          <table class="pb-tbl"><thead><tr><th>Disziplin</th><th class="num">Zeit</th><th class="num">Datum</th><th class="num">WA-P.</th></tr></thead>
            <tbody>${data.pbs.map((p) => html`<tr key=${p.discipline} class=${p.date >= `${thisYear}-01-01` ? 'pb-new' : ''}>
              <td>${discLabel(p.discipline)}</td><td class="num"><strong>${p.mark}</strong></td>
              <td class="num muted">${dateShort(p.date)}</td><td class="num muted">${p.result_score || ''}</td></tr>`)}</tbody></table>
          <p class="muted small">Farbig: Bestleistung aus ${thisYear}.</p></details>`}
        <div class="row between">
          ${years.length > 1 ? html`<div class="seg small">${years.map((yy) =>
            html`<button class=${yy === y ? 'active' : ''} onClick=${() => setYear(yy)}>${yy}</button>`)}</div>` : html`<span class="muted small">${y || ''}</span>`}
          <div><span class="big">${fmtPts(total)}</span> <span class="muted small">Punkte${y ? ` ${y}` : ''}</span></div>
        </div>
        ${discs.length > 1 && html`<div class="row between">
          <select value=${d} onChange=${(e) => setDisc(e.target.value)} aria-label="Disziplin">
            <option value="">Alle Disziplinen</option>${discs.map((x) => html`<option value=${x}>${x}</option>`)}</select>
          ${d && html`<span class="muted small">${fmtPts(discTotal)} Punkte in ${d}</span>`}</div>`}
        <div class="row between">
          <span class="muted small">Sortieren: „Datum“ oder „Pkt.“ antippen (orange = aktiv)</span>
          <label class="check small"><input type="checkbox" checked=${allRuns} onChange=${(e) => setAllRuns(e.target.checked)} /> auch ohne Punkte</label>
        </div>
        ${shown.length === 0 ? html`<p class="muted">Keine Ergebnisse${d ? ` über ${d}` : ''}${y ? ` in ${y}` : ''}${!allRuns ? ' mit Punkten' : ''}.</p>` : html`<div class="modal-body">
          <div class="res-row res-head">
            <button type="button" class=${`sort-head ${!byPoints ? 'active' : ''}`} onClick=${() => setByPoints(false)}>Datum</button>
            <span>Wettkampf · Lauf · Zeit</span><span class="res-place">Platz</span>
            <button type="button" class=${`sort-head res-pts ${byPoints ? 'active' : ''}`} onClick=${() => setByPoints(true)}>Pkt.</button></div>
          <div class="res-table">${shown.map((x) => html`<div key=${x.id} class=${`res-row ${L && x.wa_competition_id ? 'clickable' : ''}`} onClick=${() => go(x)}>
            <span class="res-date">${shortDate(x.date)}</span>
            <span class="res-what"><b>${x.relay ? `Staffel ${RELAYS[x.relay]?.label || x.relay}` : discWithKm(x.discipline, x.competition)}${x.race && x.race !== 'F' ? ` · ${raceLabel(x.race)}` : ''} · <span class="nowrap">${x.mark || '–'}</span></b>
              ${(x.record || isTitle(x) || Number(x.pts?.pb_points) > 0) && html`<span class="res-tags">
                ${isTitle(x) && html`<span>🏆 Meister</span>`}
                ${x.record && html`<span><span class="badge b-rec">${x.record}</span> ${RECORD[x.record]}</span>`}
                ${Number(x.pts?.pb_points) > 0 && html`<span>${Number(x.pts.pb_points) < Number(x.pbFull)
                  ? html`<span class="badge b-pb">=PB</span> Bestleistung eingestellt` : html`<span class="badge b-pb">PB</span> Bestleistung`}</span>`}</span>`}
              <small title=${x.competition}>${x.country ? `${flag(x.country)} ` : ''}${compShort(x.competition)}${(x.champ_category || x.category) ? html` <${CatBadge} cat=${x.champ_category || x.category} />` : ''}</small>
              ${x.champ_place && html`<small class="muted">Gesamtfeld: ${x.place ? `${x.place}. Platz` : '–'}${x.category ? ` (Kat. ${x.category})` : ''}</small>`}
              ${x.relay && html`<small class="muted">gewertet als ${discLabel(x.discipline)} (Durchschnitt je Läufer), 1/${RELAYS[x.relay]?.legs || 3} der Punkte</small>`}
              ${runNote(x) && html`<small class="muted">${runNote(x)}</small>`}
              ${(x.result_score || x.pts) && html`<small class="muted">${[x.result_score && `${x.result_score} WA-P.`, x.pts && [
                `Leistung ${fmtPts(x.pts.perf_points)}`, `Platz ${fmtPts(x.pts.placing_points)}`,
                Number(x.pts.record_points) && `Rekord ${fmtPts(x.pts.record_points)}`, Number(x.pts.pb_points) && `PB ${fmtPts(x.pts.pb_points)}`,
              ].filter(Boolean).join(' + ')].filter(Boolean).join(' · ')}</small>`}
              ${x.source === 'manual' && html`<small class="muted">Nachtrag${x.source_url ? html` · <a href=${x.source_url} target="_blank" rel="noopener"
                onClick=${(e) => e.stopPropagation()}>Quelle</a>` : ''}${!x.pts ? ' · zählt nicht (World Athletics führt das Ergebnis oder unter der Schwelle)' : ''}</small>`}
              ${data.admin && editRec && html`<small class="row" onClick=${(e) => e.stopPropagation()}><select class="mini" value=${x.record || ''}
                onChange=${(e) => setRecord(x, e.target.value)} aria-label="Rekord"><option value="">kein Rekord</option>
                ${Object.entries(RECORD).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
                <label class="mini-label">Meisterschaft Platz <input class="mini" type="number" min="1" style="width:4em" value=${x.champ_place ?? ''}
                  onChange=${(e) => setChamp(x, e.target.value)} /></label></small>`}
              ${x.wa_competition_id && html`<small><a href=${waResultUrl(x.wa_competition_id, x.wa_event_id)} target="_blank" rel="noopener"
                onClick=${(e) => e.stopPropagation()}>WA-Ergebnis ↗</a></small>`}</span>
            <span class="res-place">${placeLabel(x)}</span>
            <span class="res-pts">${x.pts ? fmtPts(x.pts.points) : ''}</span>
          </div>`)}</div>
        </div>`}
        ${data.toplists.length > 0 && html`<details class="toplists"><summary class="small">Toplisten (DE)</summary>
          <table class="pb-tbl"><thead><tr><th>Jahr</th><th>Disziplin</th><th class="num">Platz</th><th class="num">Zeit</th></tr></thead>
            <tbody>${data.toplists.map((t) => html`<tr key=${t.year + t.discipline} class=${L ? 'clickable' : ''} onClick=${() => toTop(t)}>
              <td class="muted">${t.year}</td><td>${discLabel(t.discipline)}</td><td class="num"><strong>${t.rank}.</strong></td>
              <td class="num">${t.mark}</td></tr>`)}</tbody></table></details>`}`}
      <p class="muted small">Quelle: World Athletics, Nachträge mit eigener Quelle. Antippen öffnet den Wettkampf bzw. die Topliste.
        ${data?.admin && html` <button type="button" class="linkish small" onClick=${() => setEditRec(!editRec)}>${editRec ? 'Fertig' : 'Rekord/Meisterschaft von Hand eintragen'}</button>`}</p>
    </div>
  </div>`;
}
