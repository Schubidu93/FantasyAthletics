// Admin-Bereiche nur für Athletics Fantasy: Wertungsparameter (unter Einstellungen), Athleten hinzufügen, Nachträge
import { html, useState } from '../vendor/preact-htm.js';
import { COUNTRY_CODES, flag, fmtDate, fmtDateTime, Loading, Msg, q, rpc, sb, today, useAction, useLoad, withFlag } from '../lib.js';
import { CatBadge, discLabel, RELAYS } from './lib.js';
import { RiderCell } from './index.js';
import { RiderPicker } from '../views/picker.js';

/** Zusätzliche Bereiche im Admin (Reiter) und ihre Seiten */
export const ADMIN_SECTIONS = [['athletes', 'Athleten'], ['results', 'Nachträge']];

export function SettingsExtra({ c }) {
  const cfg = useLoad(() => q(sb.from('scoring_config').select('*').eq('id', 1)).then((r) => r[0]), []);
  const [f, setF] = useState(null);
  const a = useAction();
  if (!cfg.data) return html`<${Loading} error=${cfg.error} />`;
  const v = f || cfg.data;
  const set = (k) => (e) => setF({ ...v, [k]: e.target.value });
  const field = (k, label, step = '1') => html`<label>${label}<input type="number" step=${step} min="0" value=${v[k]} onInput=${set(k)} /></label>`;
  return html`<details class="season-zone"><summary>Punkte und Athletenpool</summary>
    <p class="small muted">Gilt für alle Ligen. Nach dem Speichern werden alle Punkte neu berechnet (eingefrorene Spieltage bleiben).</p>
    <div class="grid2 compact">
      ${field('pool_threshold', 'Pool: WA-Punkte mindestens')}
      ${field('perf_threshold', 'Leistung: Schwelle (WA-Punkte)')}
      ${field('perf_factor', 'Leistung: Faktor', '0.01')}
      ${field('placing_factor', 'Platzierung: Faktor', '0.01')}
      ${field('cross_factor', 'Cross: Faktor', '0.01')}
      ${field('new_group_threshold', 'Neue Athleten: Gruppe ab WA-Punkten')}
      ${field('record_dr', 'Bonus Landesrekord (DR, NR)')}
      ${field('record_er', 'Bonus Europarekord')}
      ${field('record_wr', 'Bonus Weltrekord')}
      ${field('pb_points', 'Bonus persönliche Bestleistung')}
      <label>Spieljahr<input type="number" min="2025" placeholder=${`automatisch (${new Date().getMonth() >= 10 ? new Date().getFullYear() + 1 : new Date().getFullYear()})`}
        value=${v.game_year ?? ''} onInput=${set('game_year')} /></label>
    </div>
    <p class="small muted">Disziplingruppe und Pool-Rang richten sich nach den Punkten im Vorjahr des Spieljahrs (Saison 2027 → Punkte 2026).
      Ab 1. November gilt automatisch das Folgejahr als Spieljahr.</p>
    <p class="small muted">Punkte je Ergebnis = (max(0, WA-Punkte − Schwelle) × Leistungsfaktor + WA-Platzierungspunkte × Platzierungsfaktor)
      × Disziplinfaktor. Cross: max(0, Wert der WA-Cross-Tabelle − Schwelle) × Cross-Faktor × Distanzfaktor.
      Rekorde erkennt die App täglich an den All-time-Listen von World Athletics. Es zählt nur der höchste (WR vor ER vor DR).</p>
    <div class="row"><button class="primary" disabled=${a.busy || !f}
      onClick=${() => a.run(async () => {
        await rpc('update_scoring_config', { p_settings: { pool_threshold: +v.pool_threshold, perf_threshold: +v.perf_threshold,
          perf_factor: +v.perf_factor, placing_factor: +v.placing_factor, cross_factor: +v.cross_factor,
          new_group_threshold: +v.new_group_threshold, record_dr: +v.record_dr, record_er: +v.record_er, record_wr: +v.record_wr, pb_points: +v.pb_points, game_year: v.game_year === '' || v.game_year == null ? '' : +v.game_year } });
        setF(null); cfg.reload(); c.reload();
      }, 'Gespeichert, Punkte neu berechnet.')}>Speichern</button></div>
    <${Msg} msg=${a.msg} /></details>`;
}

// ---- Athlet hinzufügen: per WA-ID, Profil-Link oder Name; der Ablauf „Athlet hinzufügen“ lädt alles ------
const REQ_STATUS = { offen: 'wartet', 'läuft': 'wird geladen', fertig: 'fertig', mehrdeutig: 'mehrere Treffer', fehler: 'Fehler' };
function AddAthlete({ c }) {
  const list = useLoad(() => q(sb.from('athlete_requests').select('*').order('id', { ascending: false }).limit(30)), []);
  const [query, setQuery] = useState('');
  const a = useAction();
  const add = (e) => {
    e.preventDefault();
    a.run(async () => { await rpc('request_athlete', { p_query: query }); setQuery(''); list.reload(); },
      'Auftrag angelegt – in wenigen Minuten ist der Athlet mit Ergebnissen und Bestleistungen da (Liste unten aktualisieren).');
  };
  return html`<div class="stack">
    <section class="card stack">
      <h3>Athlet hinzufügen</h3>
      <p class="muted small">Für Athleten, die nicht automatisch im Pool sind (z. B. unter der Punkte-Grenze oder aus dem Ausland).
        Am sichersten mit der WA-ID oder dem Link zum Profil bei World Athletics; bei Namen sucht die App und zeigt bei mehreren Treffern Vorschläge. Geschlecht, Land und Geburtsdatum kommen von World Athletics.
        Ergebnisse 2025/2026 und Bestleistungen werden geladen, der Athlet ist danach im Pool und draftbar.</p>
      <form class="stack" onSubmit=${add}>
        <label>WA-ID, Profil-Link oder Name<input value=${query} onInput=${(e) => setQuery(e.target.value)}
          placeholder="z. B. 14682657 oder Tom Thurley" required /></label>
        <div class="row"><button class="primary" disabled=${a.busy || !query.trim()}>Hinzufügen</button></div>
      </form>
      <${Msg} msg=${a.msg} />
    </section>
    <section class="card stack">
      <div class="row between"><h3>Aufträge</h3><button class="small ghost" onClick=${() => list.reload()}>Aktualisieren</button></div>
      ${!list.data ? html`<${Loading} error=${list.error} />` : list.data.length === 0 ? html`<p class="muted small">Noch keine.</p>` : html`<ul class="list compact">
        ${list.data.map((r) => html`<li key=${r.id} class="manual-row">
          <span><strong>${r.query}</strong> <span class=${`tag ${r.status === 'fertig' ? 'ok' : r.status === 'fehler' || r.status === 'mehrdeutig' ? 'warn' : ''}`}>${REQ_STATUS[r.status] || r.status}</span>
            <br /><small class="muted">${fmtDateTime(r.created_at)}${r.message ? ` · ${r.message}` : ''}</small></span></li>`)}</ul>`}
    </section>
  </div>`;
}

// ---- Nachträge: Ergebnisse, die World Athletics nicht führt (z. B. RaceResult) ------

const ROAD = ['5 Kilometres Road', '10 Kilometres Road', '15 Kilometres Road', '10 Miles Road', '20 Kilometres Road',
  'Half Marathon', '25 Kilometres Road', '30 Kilometres Road', 'Marathon'];

const EMPTY_MANUAL = { relay: '', discipline: '10 Kilometres Road', competition_id: '', date: '', mark: '', competition: '', venue: '',
  country: '', category: 'F', place: '', source_url: '', wa_points: '' };
// Staffel-Endzeit „6:08:33“ als 6:08,33 lesen; Teilstrecke = Endzeit / Anzahl Läufer
const relayMark = (m) => (/^\d{1,2}:\d{2}:\d{2}$/.test(m.trim()) && +m.split(':')[0] < 30 ? m.trim().replace(/:(\d{2})$/, '.$1') : m.trim());
const secs = (m) => { const v = String(m || '').replace(',', '.').match(/^(\d+(?::\d{1,2}){0,2}(?:\.\d+)?)/); return v ? v[1].split(':').reduce((a, x) => a * 60 + +x, 0) : null; };
const fmtSecs = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

function ManualResults({ c }) {
  const list = useLoad(() => q(sb.from('wa_results')
    .select('id,athlete_id,date,competition,venue,country,category,place,discipline,mark,result_score,source_url,relay')
    .eq('source', 'manual').order('date', { ascending: false }).order('id').limit(500)), []);
  const comps = useLoad(() => rpc('manual_competitions'), []);
  const counted = useLoad(async () => {
    const ids = (list.data || []).map((x) => x.id);
    return ids.length ? new Set((await q(sb.from('results').select('wa_result_id').in('wa_result_id', ids))).map((x) => x.wa_result_id)) : new Set();
  }, [list.data]);
  const [riders, setRiders] = useState([]);
  const [f, setF] = useState(EMPTY_MANUAL);
  const [edit, setEdit] = useState(null);       // IDs der Zeilen, die ersetzt werden
  const [check, setCheck] = useState(null);
  const a = useAction();
  // Quelle vorbelegen: gleicher Wettkampf (und möglichst gleiche Disziplin) wie ein früherer Nachtrag → gleiche Ergebnisliste
  const withSource = (n) => {
    if (n.source_url || !n.competition) return n;
    const same = (list.data || []).filter((x) => x.source_url && x.competition === n.competition);
    const hit = same.find((x) => x.discipline === (RELAYS[n.relay]?.leg || n.discipline)) || same[0];
    return hit ? { ...n, source_url: hit.source_url } : n;
  };
  const set = (k) => (e) => { setF(withSource({ ...f, [k]: e.target.value })); setCheck(null); };
  const relay = RELAYS[f.relay];
  const maxRiders = relay ? relay.legs : 1;
  const mark = relay ? relayMark(f.mark) : f.mark.trim();
  const legMark = relay && secs(mark) ? fmtSecs(secs(mark) / relay.legs) : mark;
  const comp = (comps.data || []).find((x) => x.id === f.competition_id);
  const ready = riders.length && f.date && f.mark.trim() && (comp || (f.competition.trim() && f.country));
  const pick = (r) => { if (!riders.some((x) => x.id === r.id)) setRiders(relay ? [...riders, r].slice(0, maxRiders) : [r]); setCheck(null); };
  const pickComp = (id) => {
    const x = (comps.data || []).find((y) => y.id === id);
    setF(withSource({ ...f, competition_id: id, ...(x ? { competition: x.name, venue: x.venue || '', country: x.country || '', category: x.category || 'F',
      date: f.date && f.date >= x.start_date ? f.date : x.start_date } : { competition: '', venue: '', country: '', category: 'F' }) }));
    setCheck(null);
  };
  const doCheck = () => a.run(async () => {
    const out = [];
    for (const r of riders) {
      out.push({ r, ...(await rpc('manual_result_check', { p_rider: r.id, p_discipline: relay ? relay.leg : f.discipline, p_date: f.date, p_mark: legMark })) });
    }
    setCheck(out);
  });
  const reset = () => { setF(EMPTY_MANUAL); setRiders([]); setCheck(null); setEdit(null); };
  const save = () => a.run(async () => {
    await rpc('save_manual_result', { p: { ...f, mark, athlete_ids: riders.map((r) => r.id), place: f.place === '' ? null : +f.place,
      wa_points: f.wa_points === '' ? null : +f.wa_points, ...(edit ? { replace_ids: edit } : {}) } });
    reset(); list.reload(); comps.reload();
  }, edit ? 'Nachtrag geändert.' : 'Ergebnis nachgetragen – zählt ab sofort in der Wertung.');
  const missing = check && check.some((x) => x.wa_points == null) && f.wa_points === '';
  const dup = check && !relay && check.find((x) => x.duplicate && !(edit && x.duplicate));
  // Liste: Staffeln zusammenfassen
  const groups = [];
  for (const x of list.data || []) {
    const key = x.relay ? `${x.date}|${x.competition}|${x.relay}|${x.mark}` : `id${x.id}`;
    const g = groups.find((y) => y.key === key);
    if (g) g.rows.push(x); else groups.push({ key, rows: [x] });
  }
  const startEdit = (g) => {
    const x = g.rows[0];
    setF({ ...EMPTY_MANUAL, relay: x.relay || '', discipline: x.relay ? EMPTY_MANUAL.discipline : x.discipline, date: x.date, mark: x.mark || '',
      competition: x.competition, venue: x.venue || '', country: x.country || '', category: x.category || 'F', place: x.place ?? '',
      source_url: x.source_url || '' });
    setRiders(g.rows.map((y) => c.riderMap[y.athlete_id] || { id: y.athlete_id, name: y.athlete_id }));
    setEdit(g.rows.map((y) => y.id)); setCheck(null);
    document.querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return html`<div class="stack">
    <section class="card stack">
      <h3>${edit ? 'Nachtrag ändern' : 'Ergebnis nachtragen'}</h3>
      <p class="muted small">Für Rennen auf vermessenen Strecken, die World Athletics nicht führt (z. B. Ergebnisse bei RaceResult).
        Bruttozeit eintragen – die App berechnet die WA-Punkte. Mit Platz und Kategorie gibt es auch Platzierungspunkte.
        Staffeln: Endzeit eintragen; gewertet wird die Durchschnittszeit je Läufer, jeder bekommt ein Drittel bzw. Viertel der Punkte.
        Taucht ein Einzelergebnis später bei World Athletics auf, gilt das WA-Ergebnis.</p>
      <div class="grid2 compact">
        <label>Art<select value=${f.relay} onChange=${(e) => { setF({ ...f, relay: e.target.value }); setRiders(riders.slice(0, RELAYS[e.target.value]?.legs || 1)); setCheck(null); }}>
          <option value="">Einzelergebnis</option>${Object.entries(RELAYS).map(([k, r]) => html`<option value=${k}>Staffel ${r.label}</option>`)}</select></label>
        ${!relay && html`<label>Disziplin<select value=${f.discipline} onChange=${set('discipline')}>${ROAD.map((d) => html`<option value=${d}>${discLabel(d)}</option>`)}</select></label>`}
      </div>
      ${riders.map((r) => html`<div class="row between" key=${r.id}><${RiderCell} r=${r} />
        <button class="small ghost" onClick=${() => { setRiders(riders.filter((x) => x.id !== r.id)); setCheck(null); }}>Entfernen</button></div>`)}
      ${riders.length < maxRiders && html`<${RiderPicker} people=${c.people} onPick=${pick} limit=${6}
        placeholder=${relay ? `Läufer ${riders.length + 1} von bis zu ${maxRiders} suchen …` : 'Athlet suchen …'} />`}
      <div class="grid2 compact">
        <label>Veranstaltung<select value=${f.competition_id} onChange=${(e) => pickComp(e.target.value)}>
          <option value="">Neue Veranstaltung</option>
          ${(comps.data || []).map((x) => html`<option value=${x.id}>${fmtDate(x.start_date)} · ${x.name}</option>`)}</select></label>
        <label>Datum<input type="date" max=${today()} value=${f.date} onInput=${set('date')} /></label>
        ${!comp && html`<label>Wettkampf<input placeholder="z. B. Stadtlauf Musterstadt" value=${f.competition} onInput=${set('competition')} /></label>`}
        <label>Land<select value=${f.country} onChange=${set('country')} required>
          <option value="">– bitte wählen –</option>${COUNTRY_CODES.map((x) => html`<option value=${x}>${withFlag(x)}</option>`)}</select></label>
        <label>Ort (optional)<input value=${f.venue} onInput=${set('venue')} /></label>
        <label>Kategorie<select value=${f.category} onChange=${set('category')}>
          ${['F', 'E', 'D', 'C', 'B', 'A', 'GL', 'GW', 'DF', 'OW'].map((k) => html`<option value=${k}>${k}</option>`)}</select></label>
        <label>${relay ? 'Endzeit der Staffel' : 'Bruttozeit'}<input autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder=${relay ? 'z. B. 6:08.33' : 'z. B. 29:18 oder 1:02:45'}
          value=${f.mark} onInput=${set('mark')} /></label>
        <label>Platz (optional)<input type="number" min="1" value=${f.place} onInput=${set('place')} /></label>
        <label>Quelle (Link)<input type="url" placeholder="https://my.raceresult.com/…" value=${f.source_url} onInput=${set('source_url')} /></label>
      </div>
      ${relay && secs(mark) && html`<p class="small muted">Durchschnitt je Läufer: <strong>${legMark}</strong> über ${discLabel(relay.leg)}</p>`}
      <div class="row"><button disabled=${a.busy || !ready} onClick=${doCheck}>Punkte berechnen</button>
        ${edit && html`<button class="ghost" onClick=${reset}>Abbrechen</button>`}</div>
      ${check && html`<div class="stack">
        ${dup && html`<p class="note err">Schon vorhanden: ${fmtDate(dup.duplicate.date)} · ${dup.duplicate.competition} · ${dup.duplicate.mark}
          (${dup.duplicate.source === 'wa' ? 'World Athletics' : 'Nachtrag'}) – nicht doppelt eintragen.</p>`}
        ${check.map((x) => x.wa_points != null && html`<p class=${`note ${x.wa_points > x.threshold ? 'ok' : ''}`} key=${x.r.id}>
          ${riders.length > 1 ? `${x.r.name}: ` : ''}<strong>${x.wa_points} WA-Punkte</strong>${' – '}${x.wa_points > x.threshold
            ? `über der Schwelle${relay ? `, zählt zu 1/${relay.legs}` : ', zählt in der Wertung'}.` : `unter der Schwelle von ${x.threshold}.`}</p>`)}
        ${check.some((x) => x.wa_points == null) && html`<label>WA-Punkte<input type="number" value=${f.wa_points} onInput=${(e) => setF({ ...f, wa_points: e.target.value })} />
          <small class="muted">Für diese Disziplin kann die App die Punkte noch nicht berechnen (zu wenige WA-Ergebnisse) – bitte von Hand eintragen.</small></label>`}
      </div>`}
      <div class="row"><button class="primary" disabled=${a.busy || !check || dup || missing || !ready} onClick=${save}>${edit ? 'Änderung speichern' : 'Speichern'}</button></div>
      <${Msg} msg=${a.msg} />
    </section>
    <section class="card stack">
      <h3>Alle Nachträge</h3>
      ${!list.data ? html`<${Loading} error=${list.error} />` : groups.length === 0 ? html`<p class="muted small">Noch keine.</p>` : html`<ul class="list compact">
        ${groups.map((g) => { const x = g.rows[0]; return html`<li key=${g.key} class="manual-row">
          <span>${fmtDate(x.date)} · <strong>${g.rows.map((y) => c.riderMap[y.athlete_id]?.name || y.athlete_id).join(', ')}</strong>
            <br />${x.relay ? `Staffel ${RELAYS[x.relay]?.label || x.relay}` : discLabel(x.discipline)} ${x.mark} · ${x.result_score} WA-P.${x.place ? ` · Platz ${x.place}` : ''}
            <span class="muted"> – ${x.country ? flag(x.country) + ' ' : ''}${x.competition} <${CatBadge} cat=${x.category} />${x.source_url
              ? html` · <a href=${x.source_url} target="_blank" rel="noopener">Quelle</a>` : ''}
            ${counted.data && !g.rows.some((y) => counted.data.has(y.id)) ? ' · zählt nicht' : ''}</span></span>
          <span class="row nowrap"><button class="small" disabled=${a.busy} onClick=${() => startEdit(g)}>Bearbeiten</button>
          <button class="small ghost" disabled=${a.busy} onClick=${() => confirm('Nachtrag löschen?') && a.run(async () => {
            for (const y of g.rows) await rpc('delete_manual_result', { p_id: y.id });
            list.reload(); }, 'Nachtrag gelöscht.')}>Löschen</button></span></li>`; })}</ul>`}
    </section>
  </div>`;
}

export const ADMIN_VIEWS = { athletes: AddAthlete, results: ManualResults };
