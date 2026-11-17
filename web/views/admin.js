import { html, useState } from '../vendor/preact-htm.js';
import { sb, q, all, rpc, useLoad, useAction, Msg, Loading, RiderPicker, RiderCell, fmtDate, fmtDateTime, normName, discLabel, today,
  RELAYS, COUNTRY_CODES, withFlag, flag, CatBadge } from '../lib.js';
import { fmtUntil } from '../lib.js';
import { LeagueSettingsFields } from './home.js';

const SECTIONS = [['settings', 'Einstellungen'], ['members', 'Mitglieder'], ['import', 'Offline-Draft'],
  ['matchdays', 'Spieltage'], ['athletes', 'Athleten'], ['results', 'Nachträge'], ['fix', 'Korrekturen'], ['log', 'Protokoll']];

export function Admin({ c, sub }) {
  if (!c.isAdmin) return html`<p class="card muted">Nur für den Liga-Admin.</p>`;
  const s = sub || 'settings';
  const View = { settings: Settings, members: Members, import: OfflineImport, matchdays: Matchdays, athletes: AddAthlete, results: ManualResults, fix: Fixes, log: Log }[s];
  return html`<div class="stack">
    <nav class="seg wrap-seg">${SECTIONS.filter(([k]) => k !== 'import' || c.league.draft_mode === 'offline').map(([k, l]) =>
      html`<a href=${`#/league/${c.league.id}/admin/${k}`} class=${k === s ? 'active' : ''}>${l}</a>`)}</nav>
    <${View} c=${c} />
  </div>`;
}

// ---- Einstellungen -------------------------------------------------------

function Settings({ c }) {
  const l = c.league;
  const locked = l.status !== 'setup';
  const [f, setF] = useState({ ...l });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const a = useAction();
  const save = (e) => {
    e.preventDefault();
    const s = { name: f.name, scoring_mode: f.scoring_mode, waiver_mode: f.waiver_mode, transfer_mode: f.transfer_mode, season_end: f.season_end };
    if (!locked) Object.assign(s, {
      max_managers: +f.max_managers, roster_size: +f.roster_size,
      draft_mode: f.draft_mode, draft_order: f.draft_order, bid_seconds: +f.bid_seconds, gender: f.gender, season_start: f.season_start,
      lineup_mode: f.gender === 'mixed' ? f.lineup_mode : 'free', lineup_groups: f.lineup_groups, wildcards: +f.wildcards,
    });
    a.run(async () => { await rpc('update_league_settings', { p_league: l.id, p_settings: s }); c.reload(); }, 'Gespeichert.');
  };
  return html`<section class="card">
    <form class="stack" onSubmit=${save}>
      <label>Name der Liga<input value=${f.name} onInput=${set('name')} /></label>
      <${LeagueSettingsFields} f=${f} set=${set} locked=${locked} />
      ${locked && html`<p class="muted small">Nach dem Draft sind nur noch Wertungsmodus (gilt ab dem nächsten Stichtag), Transfers, Waiver-Modus und Saisonende änderbar.
        Beim Wechsel der Transfers werden die Standardfristen künftiger Spieltage neu gesetzt.</p>`}
      <div class="row"><button class="primary" disabled=${a.busy}>Speichern</button></div>
      <${Msg} msg=${a.msg} />
    </form>
    <${ScoringConfig} c=${c} />
    <${NewSeason} c=${c} />
    <${DeleteLeague} c=${c} />
  </section>`;
}

// Wertungsparameter – gelten für alle Ligen (es gibt nur einen Athletenpool und eine Punkteberechnung)
function ScoringConfig({ c }) {
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
      ${field('record_dr', 'Bonus deutscher Rekord')}
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

function NewSeason({ c }) {
  const y = +c.league.season_end.slice(0, 4) + 1;
  const [f, setF] = useState({ name: c.league.name.replace(/\b20\d\d\b/, '').trim() + ` ${y}`, start: `${y}-01-01`, end: `${y}-12-31`, keepers: 0, surcharge: 5 });
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<details class="season-zone"><summary>Neue Saison anlegen</summary>
    <p class="small muted">Legt eine neue Liga mit denselben Mitspielern und Einstellungen an. Alle sind sofort Mitglied.
      Mit Keepern darf jeder Manager Athleten aus seinem jetzigen Kader behalten – zum diesjährigen Preis plus Aufschlag.</p>
    <div class="grid2 compact">
      <label>Name<input value=${f.name} onInput=${set('name')} /></label>
      <label>Saisonstart<input type="date" value=${f.start} onInput=${set('start')} /></label>
      <label>Saisonende<input type="date" value=${f.end} onInput=${set('end')} /></label>
      <label>Keeper pro Manager (0–10)<input type="number" min="0" max="10" value=${f.keepers} onInput=${set('keepers')} /></label>
      ${+f.keepers > 0 && html`<label>Aufschlag auf den Preis<input type="number" min="0" max="50" value=${f.surcharge} onInput=${set('surcharge')} /></label>`}
    </div>
    <div class="row"><button class="primary" disabled=${a.busy}
      onClick=${() => a.run(async () => {
        const id = await rpc('copy_league', { p_league: c.league.id, p_name: f.name, p_season_start: f.start, p_season_end: f.end,
          p_keeper_count: +f.keepers, p_keeper_surcharge: +f.surcharge });
        location.hash = `#/league/${id}/admin`;
      })}>Neue Saison anlegen</button></div>
    <${Msg} msg=${a.msg} /></details>`;
}

function DeleteLeague({ c }) {
  const [confirm, setConfirm] = useState('');
  const a = useAction();
  return html`<details class="danger-zone"><summary>Liga löschen</summary>
    <p class="small">Löscht die Liga mit allen Kadern und Punkten unwiderruflich. Zum Bestätigen den Liganamen eingeben.</p>
    <div class="row"><input value=${confirm} onInput=${(e) => setConfirm(e.target.value)} placeholder=${c.league.name} />
      <button class="danger" disabled=${confirm !== c.league.name || a.busy}
        onClick=${() => a.run(async () => { await rpc('delete_league', { p_league: c.league.id }); location.hash = '#/'; })}>Endgültig löschen</button></div>
    <${Msg} msg=${a.msg} /></details>`;
}

// ---- Mitglieder ----------------------------------------------------------

function Members({ c }) {
  const link = `${location.origin}${location.pathname}#/join/${c.league.invite_code}`;
  const [ph, setPh] = useState('');
  const a = useAction();
  const act = (fn, args, ok) => a.run(async () => { await rpc(fn, args); c.reload(); }, ok);
  return html`<section class="card stack">
    <h3>Einladen</h3>
    <div class="row"><input readonly value=${link} onFocus=${(e) => e.target.select()} />
      <button onClick=${() => navigator.clipboard.writeText(link).then(() => a.setMsg({ ok: true, text: 'Link kopiert.' }))}>Kopieren</button></div>
    <p class="muted small">Code: <code>${c.league.invite_code}</code> · ${c.managers.length}/${c.league.max_managers} Plätze</p>

    <h3>Manager</h3>
    <ul class="list">${c.managers.map((m) => html`<li key=${m.id}>
      <span>${m.team_name} ${m.user_id === c.league.admin_user ? html`<span class="tag">Admin</span>` : ''}
        ${!m.user_id ? html`<span class="tag">frei – per Einladungslink übernehmbar</span>` : ''}</span>
      <span class="row">
        ${m.user_id && m.user_id !== c.league.admin_user && html`<button class="small ghost"
          onClick=${() => confirm(`Admin-Rechte an ${m.team_name} übertragen?`) && act('transfer_admin', { p_league: c.league.id, p_manager: m.id }, 'Übertragen.')}>Zum Admin machen</button>`}
        ${m.user_id !== c.league.admin_user && html`<button class="small danger"
          onClick=${() => confirm(c.league.status === 'setup' ? `${m.team_name} entfernen?` : `${m.team_name} vom Konto lösen? Der Kader bleibt und kann von einem Nachfolger übernommen werden.`)
            && act('remove_manager', { p_league: c.league.id, p_manager: m.id })}>
          ${c.league.status === 'setup' ? 'Entfernen' : 'Konto lösen'}</button>`}
      </span></li>`)}</ul>

    ${c.league.status === 'setup' && html`<form class="row" onSubmit=${(e) => { e.preventDefault(); act('add_placeholder_manager', { p_league: c.league.id, p_team_name: ph }, 'Platz angelegt.').then(() => setPh('')); }}>
      <input placeholder="Team ohne Konto anlegen (z. B. für Offline-Draft)" value=${ph} onInput=${(e) => setPh(e.target.value)} />
      <button disabled=${!ph.trim() || a.busy}>Anlegen</button></form>`}
    <${Msg} msg=${a.msg} />
  </section>`;
}

// ---- Offline-Draft-Import ------------------------------------------------

function OfflineImport({ c }) {
  const [rows, setRows] = useState([]);          // {manager_id, athlete_id, price}
  const [unmatched, setUnmatched] = useState([]);
  const [errors, setErrors] = useState(null);
  const [mgr, setMgr] = useState(c.managers[0]?.id);
  const [price, setPrice] = useState('');
  const a = useAction();

  if (c.league.status !== 'setup') return html`<p class="card muted">Die Kader sind bereits fixiert.</p>`;

  const byName = {};
  c.athletes.forEach((r) => { byName[normName(r.name)] = r; });
  const taken = new Set(rows.map((r) => r.athlete_id));

  const parseCsv = (text) => {
    const out = [], miss = [];
    text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
      const cols = line.split(/[;,\t]/).map((s) => s.trim().replace(/^"|"$/g, ''));
      if (i === 0 && /manager/i.test(cols[0])) return;      // Kopfzeile
      const [mName, rName, p] = cols;
      const m = c.managers.find((x) => normName(x.team_name) === normName(mName));
      const r = c.riderMap[rName] || byName[normName(rName)];
      if (!m || !r) miss.push(`Zeile ${i + 1}: ${!m ? `Manager „${mName}“` : ''}${!m && !r ? ' und ' : ''}${!r ? `Athlet „${rName}“` : ''} nicht gefunden`);
      else out.push({ manager_id: m.id, athlete_id: r.id, price: p === undefined || p === '' ? null : +p });
    });
    setRows(out); setUnmatched(miss); setErrors(null);
  };

  const check = (commit) => a.run(async () => {
    const errs = await rpc('import_offline_draft', { p_league: c.league.id, p_rows: rows, p_commit: commit });
    setErrors(errs);
    if (commit && errs.length === 0) { c.reload(); location.hash = `#/league/${c.league.id}/team`; }
  });

  return html`<section class="card stack">
    <h3>Kader aus Offline-Draft eintragen</h3>
    <p class="muted small">CSV mit den Spalten <code>Manager;Athlet;Preis</code> (Teamname, Name wie bei World Athletics, z. B. „Robert FARKEN“, Preis optional).
      Ohne Preis wird 0 gebucht. Geprüft wird: Kadergröße ${c.league.roster_size}, Summe ≤ 100, kein Athlet doppelt, alle Athleten im Pool.</p>
    <div class="row">
      <input type="file" accept=".csv,text/csv,text/plain" onChange=${(e) => e.target.files[0]?.text().then(parseCsv)} />
    </div>
    <details><summary>oder Text einfügen</summary>
      <textarea rows="6" placeholder="Manager;Athlet;Preis" onChange=${(e) => parseCsv(e.target.value)}></textarea></details>
    ${unmatched.length > 0 && html`<div class="note err">${unmatched.map((u) => html`<div>${u}</div>`)}</div>`}

    <h4>Einzeln hinzufügen</h4>
    <div class="row">
      <select value=${mgr} onChange=${(e) => setMgr(e.target.value)}>${c.managers.map((m) => html`<option value=${m.id}>${m.team_name}</option>`)}</select>
      <input type="number" min="0" max="100" placeholder="Preis" value=${price} onInput=${(e) => setPrice(e.target.value)} />
    </div>
    <${RiderPicker} athletes=${c.athletes.filter((r) => !taken.has(r.id))} limit=${8} action="Hinzufügen"
      onPick=${(r) => { setRows([...rows, { manager_id: mgr, athlete_id: r.id, price: price === '' ? null : +price }]); setErrors(null); }} />

    <div class="grid2">${c.managers.map((m) => {
      const mine = rows.filter((r) => r.manager_id === m.id);
      return html`<div key=${m.id}><h4>${m.team_name} <span class="muted small">${mine.length}/${c.league.roster_size} · ${mine.reduce((s, r) => s + (r.price || 0), 0)} Pkt.</span></h4>
        <ul class="list compact">${mine.map((r) => html`<li>
          <span>${c.riderMap[r.athlete_id]?.name}</span>
          <span class="row"><span class="muted">${r.price ?? 0}</span>
            <button class="small ghost" onClick=${() => setRows(rows.filter((x) => x !== r))} aria-label="entfernen">✕</button></span></li>`)}</ul></div>`;
    })}</div>

    <div class="row">
      <button disabled=${a.busy || !rows.length} onClick=${() => check(false)}>Prüfen</button>
      <button class="primary" disabled=${a.busy || !errors || errors.length > 0}
        onClick=${() => confirm('Kader jetzt fixieren? Danach sind sie wie nach einem Live-Draft festgelegt.') && check(true)}>Kader fixieren</button>
    </div>
    ${errors && (errors.length ? html`<div class="note err">${errors.map((e) => html`<div>${e}</div>`)}</div>`
      : html`<p class="note ok">Alles in Ordnung – du kannst die Kader fixieren.</p>`)}
    <${Msg} msg=${a.msg} />
  </section>`;
}

// ---- Spieltage -----------------------------------------------------------

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

function proposal(kind, start, end) {
  const out = [];
  let s = start, i = 1;
  while (s <= end) {
    let e;
    if (kind === 'weekly') e = addDays(s, 6);
    else if (kind === 'biweekly') e = addDays(s, 13);
    else { const d = new Date(s + 'T00:00:00Z'); e = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); }
    if (e > end) e = end;
    out.push({ name: kind === 'weekly' ? `Woche ${i}` : kind === 'biweekly' ? `Spieltag ${i}`
      : new Date(s + 'T00:00:00Z').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }), starts_on: s, ends_on: e });
    s = addDays(e, 1); i++;
  }
  return out;
}

// Standard: Meisterschaften als eigene Spieltage (Montag bis Sonntag der Meisterschaftswoche), dazwischen Spieltage von
// etwa einem Monat (Montag bis Sonntag; Grenze = der Montag, der dem Monatsersten am nächsten liegt). Andere Großereignisse
// (OW, DF, GW, GL) werden nicht auf zwei Spieltage verteilt.
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const wdMon = (s) => (new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7;   // Montag = 0
const nearestMonday = (s) => { const wd = wdMon(s); return addDays(s, wd <= 3 ? -wd : 7 - wd); };
const mondayAfter = (s) => addDays(s, 7 - wdMon(s));
const mondayOnOrBefore = (s) => addDays(s, -wdMon(s));
const sundayOnOrAfter = (s) => addDays(s, 6 - wdMon(s));
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5 + 1;

// Meisterschaften mit eigenem Spieltag (erkannt am Namen im WA-Kalender); Nachwuchs, Teams und Staffeln nicht
const CHAMPIONSHIPS = [
  ['Olympia', /olympic games/i],
  ['Hallen-WM', /world athletics indoor championships/i],
  ['Cross-WM', /world (athletics )?cross country championships/i],
  ['Straßen-WM', /world (athletics )?road running championships/i],
  ['WM', /world athletics championships/i],
  ['Hallen-EM', /european athletics indoor championships/i],
  ['Cross-EM', /european (athletics )?cross country championships/i],
  ['Straßen-EM', /european (running|road running) championships/i],
  ['EM', /european athletics championships/i],
  ['Hallen-DM', /(german|deutsche).*(indoor|hallen).*(championships|meisterschaften)/i],
  ['DM', /(german|deutsche) (athletics )?(championships|meisterschaften)/i],
];
const NOT_SENIOR_CHAMPS = /u\s?1[68]|u\s?2[03]|youth|junior|jugend|team|relays|staffel|masters|senioren|mountain|trail|10\s?km|half|marathon/i;
export const championshipLabel = (e) => (NOT_SENIOR_CHAMPS.test(e.name) ? null : CHAMPIONSHIPS.find(([, re]) => re.test(e.name))?.[0] || null);

// Letzter Samstag eines Monats (m = 1–12) als JJJJ-MM-TT
const lastSaturday = (y, m) => { const d = new Date(Date.UTC(y, m, 0)); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return iso(d); };
// DM und Hallen-DM trägt der Veranstalter oft erst spät in den WA-Kalender ein → übliche Termine als „voraussichtlich“
// (Hallen-DM: letztes Februar-Wochenende, DM: letztes Juli-Wochenende); Daten bei Bedarf beim Spieltag anpassen
function withExpectedChampionships(start, end, events) {
  const out = [...events];
  for (let y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) {
    for (const [label, name, month] of [['Hallen-DM', 'Deutsche Hallenmeisterschaften', 2], ['DM', 'Deutsche Meisterschaften', 7]]) {
      if (events.some((e) => championshipLabel(e) === label && e.start_date.startsWith(String(y)))) continue;
      const s = lastSaturday(y, month);
      if (s >= start && s <= end) out.push({ name, start_date: s, end_date: addDays(s, 1), guess: true });
    }
  }
  return out;
}

export function monthlyProposal(start, end, events = []) {
  // 1. Meisterschaften → eigene Spieltage (zusammengelegt, wenn sie sich überschneiden)
  const champs = [];
  for (const e of withExpectedChampionships(start, end, events)) {
    const label = championshipLabel(e) && `${championshipLabel(e)}${e.guess ? ' (vorauss.)' : ''}`;
    if (!label) continue;
    const s = mondayOnOrBefore(e.start_date < start ? start : e.start_date);
    const t = sundayOnOrAfter((e.end_date || e.start_date) > end ? end : (e.end_date || e.start_date));
    const prev = champs.find((c) => s <= c.ends_on && t >= c.starts_on);
    if (prev) {
      if (!prev.name.split(' + ').includes(label)) prev.name += ` + ${label}`;
      prev.starts_on = s < prev.starts_on ? s : prev.starts_on; prev.ends_on = t > prev.ends_on ? t : prev.ends_on;
    } else champs.push({ name: label, starts_on: s < start ? start : s, ends_on: t > end ? end : t, champ: true });
  }
  champs.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  const big = events.filter((e) => ['OW', 'DF', 'GW', 'GL'].includes(e.category));
  // 2. Lücken dazwischen in Abschnitte von etwa einem Monat teilen
  const fill = (from, to) => {
    if (from > to) return [];
    const bounds = [];
    for (let d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, 1)); ; ) {
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      const first = iso(d);
      if (first > to) break;
      let b = nearestMonday(first);
      for (let moved = true; moved; ) {   // kein Großereignis teilen
        moved = false;
        for (const e of big) {
          if (e.start_date < b && (e.end_date || e.start_date) >= b) { b = mondayAfter(e.end_date || e.start_date); moved = true; }
        }
      }
      // keine Mini-Spieltage: mindestens 2 Wochen bis zur nächsten Grenze bzw. zum Ende der Lücke
      if (days(bounds.length ? bounds[bounds.length - 1] : from, addDays(b, -1)) >= 14 && days(b, to) >= 14) bounds.push(b);
    }
    const out = [];
    let s = from;
    for (const b of [...bounds, addDays(to, 1)]) {
      const e = addDays(b, -1);
      const mid = new Date((Date.parse(s) + Date.parse(e)) / 2);
      out.push({ name: MONTHS_DE[mid.getUTCMonth()], starts_on: s, ends_on: e });
      s = b;
    }
    return out;
  };
  const out = [];
  let cursor = start;
  for (const c of champs) {
    out.push(...fill(cursor, addDays(c.starts_on, -1)), c);
    cursor = addDays(c.ends_on, 1);
  }
  out.push(...fill(cursor, end));
  // gleiche Monatsnamen unterscheiden (z. B. „Juli I“, „Juli II“)
  const count = {};
  for (const m of out) if (!m.champ) count[m.name] = (count[m.name] || 0) + 1;
  const seen = {};
  for (const m of out) if (!m.champ && count[m.name] > 1) m.name = `${m.name} ${['I', 'II', 'III'][seen[m.name] = (seen[m.name] || 0) + 1, seen[m.name] - 1]}`;
  return out.map(({ champ, ...m }) => m);
}

// Saisonblöcke der Leichtathletik: Halle, Straße/Cross im Frühjahr, Bahnsaison in Monatsblöcken
// (Meisterschaften meist im Juni bis August), Herbst mit Straßenläufen und Marathons.
function seasonProposal(start, end) {
  const y = start.slice(0, 4);
  const blocks = [['Hallensaison', `${y}-01-01`, `${y}-03-15`], ['Frühjahr', `${y}-03-16`, `${y}-04-30`],
    ['Mai', `${y}-05-01`, `${y}-05-31`], ['Juni', `${y}-06-01`, `${y}-06-30`], ['Juli', `${y}-07-01`, `${y}-07-31`],
    ['August', `${y}-08-01`, `${y}-08-31`], ['Herbst', `${y}-09-01`, `${y}-10-31`], ['Winter', `${y}-11-01`, `${y}-12-31`]];
  return blocks.map(([name, s, e]) => ({ name, starts_on: s < start ? start : s, ends_on: e > end ? end : e }))
    .filter((m) => m.starts_on <= m.ends_on);
}

function Matchdays({ c }) {
  const empty = { id: null, name: '', starts_on: '', ends_on: '', deadline: '', waiver_deadline: '' };
  const two = c.league.transfer_mode === 'waiver_free';
  const [f, setF] = useState(empty);
  const [gen, setGen] = useState(null);
  // Großereignisse aus dem Kalender, die nicht auf zwei Spieltage verteilt werden sollen
  const big = useLoad(async () => (await q(sb.from('calendar_events').select('name,category,country,start_date,end_date')
    .gte('end_date', c.league.season_start).lte('start_date', c.league.season_end)))
    .filter((e) => ['OW', 'DF', 'GW', 'GL'].includes(e.category) || championshipLabel(e)), [c.league.id]);
  const a = useAction();
  const locked = (m) => m.waivers_done || new Date(m.waiver_deadline || m.deadline) <= new Date();
  const toLocal = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      await rpc('upsert_matchday', { p_league: c.league.id, p_id: f.id, p_name: f.name, p_start: f.starts_on, p_end: f.ends_on,
        p_deadline: f.deadline ? new Date(f.deadline).toISOString() : null,
        p_waiver_deadline: two && f.waiver_deadline ? new Date(f.waiver_deadline).toISOString() : null });
      setF(empty); c.reload();
    }, 'Gespeichert.');
  };
  const createAll = () => a.run(async () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const m of gen.filter((x) => x.starts_on > today)) {
      await rpc('upsert_matchday', { p_league: c.league.id, p_id: null, p_name: m.name, p_start: m.starts_on, p_end: m.ends_on });
    }
    setGen(null); c.reload();
  }, 'Spieltage angelegt.');

  return html`<section class="card stack">
    <h3>Spieltage</h3>
    <ul class="small muted md-help">
      <li>Zeiträume dürfen unterschiedlich lang sein, aber sich nicht überlappen. Lücken sind erlaubt (Punkte darin verfallen).</li>
      <li>${two
        ? 'Standard: Waiver bis eine Woche vor Start (Tagesende; ist der vorige Spieltag kürzer als 14 Tage: bis zu seiner Hälfte), danach freie Phase bis zum Vortag des Spieltags (Tagesende). Eigene Uhrzeiten sind möglich.'
        : 'Standard-Stichtag für Waiver und Aufstellung: Vortag des Spieltags um 20:00 Uhr.'}</li>
      <li>Leere Felder = Standard. Laufende und abgeschlossene Spieltage sind gesperrt.</li>
    </ul>
    ${c.matchdays.length ? html`<ul class="list md-admin">${c.matchdays.map((m, i) => html`<li key=${m.id}>
      <span class="md-no">${i + 1}</span>
      <span class="md-what"><strong>${m.name}</strong>
        <small>${fmtDate(m.starts_on)} – ${fmtDate(m.ends_on)}</small>
        ${two && html`<small>Waiver bis ${fmtUntil(m.waiver_deadline || m.deadline)}</small>`}
        <small>${two ? 'Freie Phase' : 'Waiver & Aufstellung'} bis ${fmtUntil(m.deadline)}</small></span>
      <span class="md-actions">
        <span class="tag">${m.frozen ? 'eingefroren' : m.status === 'closed' ? 'abgeschlossen' : m.status === 'running' ? 'läuft' : locked(m) ? 'Frist vorbei' : 'geplant'}</span>
        ${!locked(m) && html`
          <button class="small ghost" onClick=${() => setF({ ...m, deadline: toLocal(m.deadline), waiver_deadline: m.waiver_deadline ? toLocal(m.waiver_deadline) : '' })}>Bearbeiten</button>
          <button class="small danger" onClick=${() => confirm(`${m.name} löschen?`) && a.run(async () => { await rpc('delete_matchday', { p_id: m.id }); c.reload(); })}>Löschen</button>`}
      </span></li>`)}</ul>` : html`<p class="muted">Noch keine Spieltage. Am schnellsten: unten „Spieltage automatisch vorschlagen“ → „Alle 2 Wochen“ oder „Saisonblöcke“ → „Alle anlegen“.</p>`}

    <form class="grid2 compact" onSubmit=${save}>
      <label>Name<input required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} placeholder="z. B. Hallensaison" /></label>
      <label>Start<input type="date" required value=${f.starts_on} onInput=${(e) => setF({ ...f, starts_on: e.target.value })} /></label>
      <label>Ende<input type="date" required value=${f.ends_on} onInput=${(e) => setF({ ...f, ends_on: e.target.value })} /></label>
      ${two && html`<label>Waiver-Auswertung (optional)<input type="datetime-local" value=${f.waiver_deadline} onInput=${(e) => setF({ ...f, waiver_deadline: e.target.value })} /></label>`}
      <label>Stichtag – Kader und Aufstellung fest (optional)<input type="datetime-local" value=${f.deadline} onInput=${(e) => setF({ ...f, deadline: e.target.value })} /></label>
      <div class="row"><button class="primary" disabled=${a.busy}>${f.id ? 'Änderung speichern' : 'Spieltag anlegen'}</button>
        ${f.id && html`<button type="button" class="ghost" onClick=${() => setF(empty)}>Abbrechen</button>`}</div>
    </form>

    <details><summary>Spieltage automatisch vorschlagen</summary>
      <div class="row">
        <button class="primary" onClick=${() => setGen(monthlyProposal(c.league.season_start, c.league.season_end, big.data || []))}>Monatlich (Mo–So)</button>
        <button onClick=${() => setGen(proposal('biweekly', c.league.season_start, c.league.season_end))}>Alle 2 Wochen</button>
        <button onClick=${() => setGen(seasonProposal(c.league.season_start, c.league.season_end))}>Saisonblöcke</button>
        <button onClick=${() => setGen(proposal('monthly', c.league.season_start, c.league.season_end))}>Kalendermonate</button>
        <button onClick=${() => setGen(proposal('weekly', c.league.season_start, c.league.season_end))}>Wöchentlich</button>
      </div>
      <p class="muted small">Empfohlen: „Monatlich (Mo–So)“ – Olympia, WM, EM, Hallen-WM/-EM, Cross- und Straßen-WM/-EM, DM und Hallen-DM
        bekommen eigene Spieltage (Montag bis Sonntag der Meisterschaftswoche), dazwischen Spieltage von etwa einem Monat (Montag bis Sonntag).
        Andere Großereignisse werden nicht geteilt. Stehen DM oder Hallen-DM noch nicht im WA-Kalender, plant der Vorschlag sie zum üblichen Termin ein (letztes Juli- bzw. Februar-Wochenende, „vorauss.“) – Daten später beim Spieltag anpassen.</p>
      ${gen && html`<p class="muted small">Vorschlag für ${fmtDate(c.league.season_start)} – ${fmtDate(c.league.season_end)}.
          Nach dem Anlegen einzeln anpassbar. Spieltage in der Vergangenheit werden übersprungen.</p>
        <ul class="list compact">${gen.map((m) => html`<li><span>${m.name}</span><span class="muted">${fmtDate(m.starts_on)} – ${fmtDate(m.ends_on)}</span></li>`)}</ul>
        <button class="primary" disabled=${a.busy || c.matchdays.length > 0} onClick=${createAll}>Alle anlegen</button>
        ${c.matchdays.length > 0 && html`<p class="muted small">Nur möglich, solange noch keine Spieltage angelegt sind.</p>`}`}
    </details>
    <${Msg} msg=${a.msg} />
  </section>`;
}

// ---- Korrekturen ---------------------------------------------------------

// ---- Athlet hinzufügen: per WA-ID, Profil-Link oder Name; der Ablauf „Athlet hinzufügen“ lädt alles ------
const REQ_STATUS = { offen: 'wartet', 'läuft': 'wird geladen', fertig: 'fertig', mehrdeutig: 'mehrere Treffer', fehler: 'Fehler' };
function AddAthlete({ c }) {
  const list = useLoad(() => q(sb.from('athlete_requests').select('*').order('id', { ascending: false }).limit(30)), []);
  const [query, setQuery] = useState('');
  const [gender, setGender] = useState(c.league.gender === 'women' ? 'women' : 'men');
  const a = useAction();
  const add = (e) => {
    e.preventDefault();
    a.run(async () => { await rpc('request_athlete', { p_query: query, p_gender: gender }); setQuery(''); list.reload(); },
      'Auftrag angelegt – in wenigen Minuten ist der Athlet mit Ergebnissen und Bestleistungen da (Liste unten aktualisieren).');
  };
  return html`<div class="stack">
    <section class="card stack">
      <h3>Athlet hinzufügen</h3>
      <p class="muted small">Für Athleten, die nicht automatisch im Pool sind (z. B. unter der Punkte-Grenze oder aus dem Ausland).
        Am sichersten mit der WA-ID oder dem Link zum Profil bei World Athletics; bei Namen sucht die App und zeigt bei mehreren Treffern Vorschläge.
        Ergebnisse 2025/2026 und Bestleistungen werden geladen, der Athlet ist danach im Pool und draftbar.</p>
      <form class="stack" onSubmit=${add}>
        <label>WA-ID, Profil-Link oder Name<input value=${query} onInput=${(e) => setQuery(e.target.value)}
          placeholder="z. B. 14682657 oder Tom Thurley" required /></label>
        <div class="seg small">${[['men', 'Männer'], ['women', 'Frauen']].map(([k, l]) =>
          html`<button type="button" class=${gender === k ? 'active' : ''} onClick=${() => setGender(k)}>${l}</button>`)}</div>
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
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setCheck(null); };
  const relay = RELAYS[f.relay];
  const maxRiders = relay ? relay.legs : 1;
  const mark = relay ? relayMark(f.mark) : f.mark.trim();
  const legMark = relay && secs(mark) ? fmtSecs(secs(mark) / relay.legs) : mark;
  const comp = (comps.data || []).find((x) => x.id === f.competition_id);
  const ready = riders.length && f.date && f.mark.trim() && (comp || (f.competition.trim() && f.country));
  const pick = (r) => { if (!riders.some((x) => x.id === r.id)) setRiders(relay ? [...riders, r].slice(0, maxRiders) : [r]); setCheck(null); };
  const pickComp = (id) => {
    const x = (comps.data || []).find((y) => y.id === id);
    setF({ ...f, competition_id: id, ...(x ? { competition: x.name, venue: x.venue || '', country: x.country || '', category: x.category || 'F',
      date: f.date && f.date >= x.start_date ? f.date : x.start_date } : { competition: '', venue: '', country: '', category: 'F' }) });
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
      ${riders.length < maxRiders && html`<${RiderPicker} athletes=${c.athletes} onPick=${pick} limit=${6}
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
        <label>${relay ? 'Endzeit der Staffel' : 'Bruttozeit'}<input inputmode="decimal" placeholder=${relay ? 'z. B. 6:08.33' : 'z. B. 29:18 oder 1:02:45'}
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

function Fixes({ c }) {
  return html`<div class="stack">
    <${PointOverride} c=${c} />
    <${RosterFix} c=${c} />
    <${Inactive} c=${c} />
  </div>`;
}

function PointOverride({ c }) {
  const overrides = useLoad(() => q(sb.from('point_overrides').select('*').eq('league_id', c.league.id).order('created_at', { ascending: false })), [c.league.id]);
  const [md, setMd] = useState(c.matchdays.find((m) => m.status !== 'planned')?.id || '');
  const [mgr, setMgr] = useState(c.managers[0]?.id);
  const [rider, setRider] = useState('');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const a = useAction();
  const athletes = [...new Set(c.roster.filter((r) => r.manager_id === mgr).map((r) => r.athlete_id))];
  const save = (val) => a.run(async () => {
    await rpc('admin_set_override', { p_league: c.league.id, p_matchday: md, p_manager: mgr, p_rider: rider,
      p_points: val === null ? null : +val, p_reason: reason });
    overrides.reload(); setPoints(''); setReason('');
  }, 'Korrektur gespeichert.');

  return html`<section class="card stack">
    <h3>Punkte korrigieren</h3>
    <p class="muted small">Setzt die Punkte eines Athleten in einem Spieltag fest (ersetzt den berechneten Wert, auch nach dem Einfrieren). Jede Korrektur wird protokolliert.</p>
    <div class="grid2 compact">
      <label>Spieltag<select value=${md} onChange=${(e) => setMd(e.target.value)}>${c.matchdays.map((m) => html`<option value=${m.id}>${m.name}</option>`)}</select></label>
      <label>Team<select value=${mgr} onChange=${(e) => { setMgr(e.target.value); setRider(''); }}>${c.managers.map((m) => html`<option value=${m.id}>${m.team_name}</option>`)}</select></label>
      <label>Athlet<select value=${rider} onChange=${(e) => setRider(e.target.value)}><option value="">– wählen –</option>
        ${athletes.map((s) => html`<option value=${s}>${c.riderMap[s]?.name || s}</option>`)}</select></label>
      <label>Punkte<input type="number" step="0.1" value=${points} onInput=${(e) => setPoints(e.target.value)} /></label>
      <label class="span2">Grund<input value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder="z. B. Ergebnis aberkannt" /></label>
    </div>
    <div class="row"><button class="primary" disabled=${a.busy || !md || !rider || points === '' || !reason.trim()} onClick=${() => save(points)}>Speichern</button></div>
    <${Msg} msg=${a.msg} />
    ${overrides.data?.length > 0 && html`<ul class="list compact">${overrides.data.map((o) => html`<li key=${o.id}>
      <span>${c.matchdays.find((m) => m.id === o.matchday_id)?.name} · ${c.managerMap[o.manager_id]?.team_name} · ${c.riderMap[o.athlete_id]?.name}: <strong>${o.points}</strong>
        <span class="muted"> – ${o.reason}</span></span>
      <button class="small ghost" onClick=${() => a.run(async () => {
        await rpc('admin_set_override', { p_league: c.league.id, p_matchday: o.matchday_id, p_manager: o.manager_id, p_rider: o.athlete_id, p_points: null, p_reason: 'Korrektur aufgehoben' });
        overrides.reload(); })}>Aufheben</button></li>`)}</ul>`}
  </section>`;
}

function RosterFix({ c }) {
  const [mgr, setMgr] = useState(c.managers[0]?.id);
  const [drop, setDrop] = useState('');
  const [reason, setReason] = useState('');
  const a = useAction();
  const mine = c.active.filter((r) => r.manager_id === mgr);
  const run = (add) => a.run(async () => {
    await rpc('admin_roster_fix', { p_league: c.league.id, p_manager: mgr, p_add: add, p_drop: drop || null, p_price: 0, p_reason: reason });
    setDrop(''); c.reload();
  }, 'Kader geändert.');
  if (c.league.status !== 'active') return null;
  return html`<section class="card stack">
    <h3>Kader korrigieren</h3>
    <p class="muted small">Sofort wirksam (ab heute), ohne Waiver. Wird protokolliert.</p>
    <div class="grid2 compact">
      <label>Team<select value=${mgr} onChange=${(e) => { setMgr(e.target.value); setDrop(''); }}>${c.managers.map((m) => html`<option value=${m.id}>${m.team_name}</option>`)}</select></label>
      <label>Abgeben<select value=${drop} onChange=${(e) => setDrop(e.target.value)}><option value="">– niemand –</option>
        ${mine.map((r) => html`<option value=${r.athlete_id}>${c.riderMap[r.athlete_id]?.name}</option>`)}</select></label>
      <label class="span2">Grund<input value=${reason} onInput=${(e) => setReason(e.target.value)} /></label>
    </div>
    ${drop && html`<button disabled=${a.busy} onClick=${() => run(null)}>Nur abgeben</button>`}
    <${RiderPicker} athletes=${c.athletes.filter((r) => !c.owner[r.id])} limit=${8} action="Aufnehmen" onPick=${(r) => run(r.id)} />
    <${Msg} msg=${a.msg} />
  </section>`;
}

function Inactive({ c }) {
  const a = useAction();
  const owned = c.active.map((r) => c.riderMap[r.athlete_id]).filter(Boolean);
  return html`<section class="card stack">
    <h3>Karriereende / Sperre</h3>
    <p class="muted small">Als inaktiv markierte Athleten kann ihr Manager außer der Reihe sofort per Waiver ersetzen.</p>
    <ul class="list compact">${owned.filter((r) => r.inactive).map((r) => html`<li key=${r.id}><span>${r.name}</span>
      <button class="small" onClick=${() => a.run(async () => { await rpc('admin_mark_inactive', { p_league: c.league.id, p_rider: r.id, p_inactive: false }); c.reload(); })}>Wieder aktiv</button></li>`)}</ul>
    <${RiderPicker} athletes=${owned.filter((r) => !r.inactive)} limit=${6} action="Inaktiv setzen"
      onPick=${(r) => a.run(async () => { await rpc('admin_mark_inactive', { p_league: c.league.id, p_rider: r.id, p_inactive: true }); c.reload(); })} />
    <${Msg} msg=${a.msg} />
  </section>`;
}

// ---- Protokoll -----------------------------------------------------------

const ACTIONS = { override: 'Punktekorrektur', roster_fix: 'Kaderkorrektur', settings: 'Einstellungen', start_draft: 'Draft gestartet',
  offline_import: 'Offline-Kader fixiert', veto_trade: 'Tausch-Veto', transfer_admin: 'Admin übertragen', remove_manager: 'Manager entfernt',
  mark_inactive: 'Athlet inaktiv' };

function Log({ c }) {
  const log = useLoad(() => q(sb.from('admin_log').select('*').eq('league_id', c.league.id).order('created_at', { ascending: false }).limit(200)), [c.league.id]);
  if (!log.data) return html`<${Loading} error=${log.error} />`;
  return html`<section class="card"><h3>Protokoll</h3>
    ${log.data.length === 0 ? html`<p class="muted">Noch keine Einträge.</p>` : html`<ul class="list compact">${log.data.map((e) => html`<li key=${e.id}>
      <span><strong>${ACTIONS[e.action] || e.action}</strong> <span class="muted small">${describe(c, e.details)}</span></span>
      <span class="muted small">${fmtDateTime(e.created_at)}</span></li>`)}</ul>`}</section>`;
}

function describe(c, d) {
  if (!d) return '';
  const parts = [];
  if (d.manager) parts.push(c.managerMap[d.manager]?.team_name || d.team);
  if (d.rider) parts.push(c.riderMap[d.rider]?.name || d.rider);
  if (d.add) parts.push(`+ ${c.riderMap[d.add]?.name || d.add}`);
  if (d.drop) parts.push(`− ${c.riderMap[d.drop]?.name || d.drop}`);
  if (d.points !== undefined) parts.push(`${d.points ?? 'aufgehoben'} Pkt.`);
  if (d.reason) parts.push(d.reason);
  return parts.filter(Boolean).join(' · ');
}
