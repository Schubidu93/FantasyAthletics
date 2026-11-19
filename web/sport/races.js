// Wettkämpfe: alle Wettkämpfe, bei denen Athleten aus dem Pool gestartet sind, mit deren Ergebnissen und Punkten
import { html, useState, useMemo } from '../vendor/preact-htm.js';
import { all, flag, fmtDate, fmtPts, Loading, nationCode, normName, openRider, q, rpcAll, sb, useLoad, withFlag } from '../lib.js';
import { BackToAthlete, CatBadge, DiscFilter, discLabel, discMeters, discWithKm, raceLabel, raceOrder, SexBadge, waResultUrl } from './lib.js';

// WA-Wettkampfkategorien (World-Ranking-Regeln): OW = Olympia/WM … F = nationale Meetings
const CATS = [['', 'Alle Kategorien'], ['top', 'OW, DF, GW, GL'], ['OW', 'OW – Olympia/WM'], ['DF', 'DF – DL-Finale'],
  ['GW', 'GW – Hallen-WM, Diamond League'], ['GL', 'GL – EM, Gold-Meetings'], ['A', 'A'], ['B', 'B – u. a. DM'],
  ['C', 'C'], ['D', 'D'], ['E', 'E'], ['F', 'F']];
const matchCat = (r, g) => !g || (g === 'top' ? ['OW', 'DF', 'GW', 'GL'].includes(r.category) : r.category === g);

// Filter bleiben beim Zurückkehren aus einem Wettkampf erhalten
const saved = { cat: '', country: '', term: '', year: String(new Date().getFullYear()), md: '', mine: false, disc: '' };
const keep = (key, setter) => (v) => { saved[key] = v; setter(v); };

export function Races({ c, sub }) {
  const races = useLoad(() => all(() => sb.from('competitions').select('id,name,category,country,venue,start_date,end_date')
    .gte('start_date', '2025-01-01').order('start_date', { ascending: false }).order('id')), []);
  if (sub) return html`<${RaceDetail} key=${sub} c=${c} slug=${decodeURIComponent(sub)} />`;
  if (!races.data) return html`<${Loading} error=${races.error} />`;
  return html`<${RaceList} c=${c} races=${races.data.map((r) => ({ ...r, country: r.country && nationCode(r.country) }))} />`;
}

function RaceList({ c, races }) {
  const [catV, setCatRaw] = useState(saved.cat);
  const [country, setCountryRaw] = useState(saved.country);
  const [term, setTermRaw] = useState(saved.term);
  const [year, setYearRaw] = useState(saved.year);
  const [mdId, setMdRaw] = useState(saved.md);
  const [mine, setMineRaw] = useState(saved.mine);
  const [disc, setDiscRaw] = useState(saved.disc);
  const setDisc = keep('disc', setDiscRaw);
  // Disziplinen je Wettkampf (für den Disziplin-Filter)
  const discs = useLoad(async () => Object.fromEntries((await rpcAll('competition_disciplines')).map((r) => [r.competition_id, r.disciplines])), []);
  const discNames = useMemo(() => [...new Set(Object.values(discs.data || {}).flat())], [discs.data]);
  const setCatV = keep('cat', setCatRaw), setCountry = keep('country', setCountryRaw), setTerm = keep('term', setTermRaw);
  const setYear = keep('year', setYearRaw), setMine = keep('mine', setMineRaw);
  const setMd = (v) => { keep('md', setMdRaw)(v); if (v) setYear(''); };
  // Wettkämpfe mit Athleten aus Kadern dieser Liga (für den Filter „nur mit Liga-Athleten“)
  const owned = useLoad(async () => {
    const slugs = Object.keys(c.owner);
    const out = new Set();
    for (let i = 0; i < slugs.length; i += 150) {
      for (const r of await all(() => sb.from('wa_results').select('wa_competition_id').in('athlete_id', slugs.slice(i, i + 150)).order('id'))) {
        if (r.wa_competition_id) out.add(`wa-c${r.wa_competition_id}`);
      }
    }
    return out;
  }, [c.league.id]);
  const years = useMemo(() => [...new Set(races.map((r) => (r.start_date || '').slice(0, 4)).filter(Boolean))].sort().reverse(), [races]);
  const countries = useMemo(() => [...new Set(races.map((r) => r.country).filter(Boolean))].sort(), [races]);
  const md = (c.matchdays || []).find((m) => m.id === mdId);
  const t = normName(term);
  const list = races.filter((r) => matchCat(r, catV) && (!country || r.country === country)
    && (!year || (r.start_date || '').slice(0, 4) === year)
    && (!md || (r.start_date <= md.ends_on && (r.end_date || r.start_date) >= md.starts_on))
    && (!mine || owned.data?.has(r.id))
    && (!disc || discs.data?.[r.id]?.includes(disc))
    && (!t || t.split(' ').every((w) => normName(`${r.name} ${r.venue || ''}`).includes(w))));

  return html`<section class="card">
    <div class="row between"><h2>Wettkämpfe</h2><span class="muted small">${list.length} Wettkämpfe</span></div>
    <div class="filters">
      <input type="search" placeholder="Name oder Ort" value=${term} onInput=${(e) => setTerm(e.target.value)} />
      <select value=${catV} onChange=${(e) => setCatV(e.target.value)}>${CATS.map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>
      <select value=${year} onChange=${(e) => setYear(e.target.value)}><option value="">Alle Jahre</option>${years.map((y) => html`<option value=${y}>${y}</option>`)}</select>
      ${(c.matchdays || []).length > 0 && html`<select value=${mdId} onChange=${(e) => setMd(e.target.value)}>
        <option value="">Alle Spieltage</option>${c.matchdays.map((m) => html`<option value=${m.id}>${m.name}</option>`)}</select>`}
      <${DiscFilter} names=${discNames} value=${disc} onChange=${setDisc} />
      <select value=${country} onChange=${(e) => setCountry(e.target.value)}><option value="">Alle Länder</option>${countries.map((x) => html`<option value=${x}>${withFlag(x)}</option>`)}</select>
      <label class="check small"><input type="checkbox" checked=${mine} onChange=${(e) => setMine(e.target.checked)} /> nur mit Athleten aus Kadern</label>
    </div>
    ${disc && !discs.data ? html`<${Loading} error=${discs.error} />` : list.length === 0 ? html`<p class="muted">Keine Wettkämpfe gefunden.</p>` : html`<ul class="list race-list">${list.slice(0, 300).map((r) => html`<li key=${r.id}>
      <a class="race-link" href=${`#/league/${c.league.id}/races/${encodeURIComponent(r.id)}`}>
        <span class="race-date">${fmtDate(r.start_date)}${r.end_date && r.end_date !== r.start_date ? ` – ${fmtDate(r.end_date)}` : ''}</span>
        <span class="race-name"><strong>${(r.name || '').replace(/\s*-\s*XC\s*[\d.,]+\s*km$/i, '')}</strong>
          <small><${CatBadge} cat=${r.category} /> ${r.country ? `${flag(r.country)} ${r.venue ? r.venue.replace(/\s*\([A-Z]{3}\)\s*$/, '') : r.country}` : ''}</small></span>
      </a></li>`)}</ul>`}
    ${list.length > 300 && html`<p class="muted small">Es werden die neuesten 300 angezeigt – Filter eingrenzen.</p>`}
  </section>`;
}

function RaceDetail({ c, slug }) {
  const [only, setOnly] = useState(saved.disc);
  const data = useLoad(async () => {
    const [race] = await q(sb.from('competitions').select('*').eq('id', slug));
    const id = slug.startsWith('wa-c') ? +slug.slice(4) : null;
    const rows = id ? await all(() => sb.from('wa_results')
      .select('id,athlete_id,date,competition,discipline,category,race,place,wa_race,wa_place,placing_round,placing_place,mark,result_score,remark,wa_event_id,champ_place')
      .eq('wa_competition_id', id).order('date').order('id')) : [];
    const pts = {};
    const ids = rows.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 150) {
      for (const p of await q(sb.from('results').select('wa_result_id,points').in('wa_result_id', ids.slice(i, i + 150)))) pts[p.wa_result_id] = p.points;
    }
    return { race, rows: rows.map((r) => ({ ...r, pts: pts[r.id] })) };
  }, [slug]);
  if (!data.data) return html`<${Loading} error=${data.error} />`;
  const { race, rows: allRows } = data.data;
  const rows = only ? allRows.filter((r) => r.discipline === only) : allRows;
  const back = html`<div class="row between"><a href=${`#/league/${c.league.id}/races`} class="small-link">← Alle Wettkämpfe</a><${BackToAthlete} /></div>`;
  if (!race) return html`<section class="card">${back}<p class="muted">Wettkampf nicht gefunden.</p></section>`;
  // nach Disziplin und Lauf gruppieren, innerhalb nach Platz
  const groups = [];
  for (const r of rows) {
    // Cross: Rennen über verschiedene Distanzen (z. B. 1,5 und 7,5 km) getrennt
    const disc = discWithKm(r.discipline, r.competition);
    // Männer und Frauen getrennt
    const sex = c.riderMap[r.athlete_id]?.gender || '';
    const key = `${r.date}|${disc}|${r.wa_race}|${sex}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, date: r.date, disc, sex, race: r.wa_race, event: r.wa_event_id, rows: [] });
    g.rows.push(r);
  }
  groups.forEach((g) => g.rows.sort((a, b) => (a.wa_place ?? 999) - (b.wa_place ?? 999)));
  // erst alle Männer-Disziplinen aufsteigend nach Strecke, dann die der Frauen; je Disziplin Vorläufe → Finale 1, 2, 3
  groups.sort((a, b) => (a.sex === 'women') - (b.sex === 'women') || discMeters(a.disc) - discMeters(b.disc)
    || a.disc.localeCompare(b.disc) || raceOrder(a.race) - raceOrder(b.race) || a.date.localeCompare(b.date));
  const total = rows.reduce((s, r) => s + Number(r.pts || 0), 0);
  return html`<section class="card stack">
    ${back}
    <div>
      <h2>${(race.name || '').replace(/\s*-\s*XC\s*[\d.,]+\s*km$/i, '')}</h2>
      <p class="muted small">${fmtDate(race.start_date)}${race.end_date && race.end_date !== race.start_date ? ` – ${fmtDate(race.end_date)}` : ''}
        ${race.venue ? ` · ${race.country ? flag(race.country) + ' ' : ''}${race.venue}` : ''} · ${fmtPts(total)} Punkte gesamt
        ${race.category ? html` <${CatBadge} cat=${race.category} />` : ''}</p>
      ${only && html`<p class="small">Nur ${discLabel(only)} ·${' '}
        <button type="button" class="linkish" onClick=${() => setOnly('')}>alle Disziplinen zeigen</button></p>`}
      ${race.id?.startsWith('wa-c') && html`<a class="small" href=${waResultUrl(race.id.slice(4))} target="_blank" rel="noopener">WA-Ergebnisse ↗</a>`}
    </div>
    ${groups.length === 0 ? html`<p class="muted">Keine Ergebnisse von Pool-Athleten.</p>` : groups.map((g) => html`<div class="detail-rider" key=${g.key}>
      <div class="row between"><strong>${g.disc}${g.race && g.race !== 'F' ? ` · ${raceLabel(g.race)}` : ''}${g.sex
        ? html` · ${g.sex === 'women' ? 'Frauen' : 'Männer'} <${SexBadge} g=${g.sex} />` : ''}</strong>
        <span class="muted small">${fmtDate(g.date)}${race.id?.startsWith('wa-c') && g.event ? html` · <a href=${waResultUrl(race.id.slice(4), g.event)} target="_blank" rel="noopener">WA ↗</a>` : ''}</span></div>
      <ul class="list compact">${g.rows.map((r) => {
        const owner = c.managerMap[c.owner[r.athlete_id]];
        const name = c.riderMap[r.athlete_id]?.name || r.athlete_id;
        return html`<li key=${r.id} class=${owner && owner.id === c.me?.id ? 'me' : ''}>
          <span><span class="res-place">${r.wa_place ? `${r.wa_place}.` : r.remark || '–'}</span>${' '}
            <button type="button" class="linkish" onClick=${() => openRider(r.athlete_id)}>${name}</button>
            <small class="muted"> ${r.mark || ''}${r.champ_place ? ` · ${r.champ_place === 1 ? '🏆 ' : ''}Meisterschaft ${r.champ_place}.` : ''}${owner ? ` · ${owner.team_name}` : ''}</small></span>
          <span>${r.pts ? html`<strong>${fmtPts(r.pts)}</strong>` : ''}</span></li>`;
      })}</ul></div>`)}
  </section>`;
}
