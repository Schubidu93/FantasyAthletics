// Kalender: kommende Wettkämpfe mit Laufdisziplinen (aus dem WA-Kalender, täglich aktualisiert)
// International ab Gold Label, Europa ab Kategorie A, Deutschland ab E – siehe importer/sync-calendar.ts
import { html, useState } from '../vendor/preact-htm.js';
import { sb, all, useLoad, Loading, normName, flag, nationCode, today } from '../lib.js';

const KIND_LABEL = { track: 'Bahn', road: 'Straße', cross: 'Cross' };
const TOP = ['OW', 'DF', 'GW', 'GL'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const day = (d) => new Date(`${d}T00:00:00`);
const dm = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const when = (e) => (!e.end_date || e.end_date === e.start_date
  ? `${WD[day(e.start_date).getDay()]} ${dm(e.start_date)}`
  : `${dm(e.start_date)}–${dm(e.end_date)}`);

const saved = { kind: '', area: '', term: '' };

export function Calendar() {
  const events = useLoad(() => all(() => sb.from('calendar_events')
    .select('id,name,venue,country,category,kinds,competition_group,start_date,end_date,events')
    .gte('start_date', new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10))
    .order('start_date').order('id')), []);
  const [kind, setKind] = useState(saved.kind);
  const [area, setArea] = useState(saved.area);
  const [term, setTerm] = useState(saved.term);
  const set = (k, f) => (e) => { saved[k] = e.target.value; f(e.target.value); };
  if (!events.data) return html`<${Loading} error=${events.error} />`;

  const now = today();
  const t = normName(term);
  const list = events.data
    .filter((e) => (e.end_date || e.start_date) >= now)
    .filter((e) => !kind || (e.kinds || []).includes(kind))
    .filter((e) => !area || (area === 'de' ? e.country === 'GER' : area === 'top' ? TOP.includes(e.category) : e.country !== 'GER'))
    .filter((e) => !t || t.split(' ').every((w) => normName(`${e.name} ${e.venue || ''} ${e.competition_group || ''}`).includes(w)));
  const months = [];
  for (const e of list) {
    const key = e.start_date.slice(0, 7);
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, items: [] });
    months[months.length - 1].items.push(e);
  }

  return html`<section class="card">
    <div class="row between"><h2>Kalender</h2><span class="muted small">${list.length} Wettkämpfe</span></div>
    <p class="muted small">Kommende Wettkämpfe mit Laufdisziplinen ab 800 m: international ab Gold Label, in Europa ab Kategorie A,
      in Deutschland ab Kategorie E. Das Programm stammt von World Athletics, sobald der Veranstalter es eingetragen hat.</p>
    <div class="filters">
      <input type="search" placeholder="Name oder Ort" value=${term} onInput=${set('term', setTerm)} />
      <select value=${kind} onChange=${set('kind', setKind)}>
        <option value="">Alle Arten</option>
        ${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value=${k}>${l}</option>`)}
      </select>
      <select value=${area} onChange=${set('area', setArea)}>
        <option value="">Alle Regionen</option><option value="top">Höchste Kategorien (OW, DF, GW, GL)</option>
        <option value="int">International</option><option value="de">Deutschland</option>
      </select>
    </div>
    ${list.length === 0 ? html`<p class="muted">Keine Wettkämpfe gefunden.</p>` : months.map((m) => html`
      <h3 class="cal-month" key=${m.key}>${MONTHS[+m.key.slice(5, 7) - 1]} ${m.key.slice(0, 4)}</h3>
      <ul class="list race-list">${m.items.map((e) => html`<li key=${e.id} class=${e.country === 'GER' ? 'cal-de' : ''}>
        <div class="cal-item">
          <span class="cal-text"><span class="race-date">${when(e)}</span>
          <span class="race-name"><strong>${e.name}</strong>
            <small>${[e.country && `${flag(nationCode(e.country))} ${(e.venue || '').replace(/\s*\([A-Z]{3}\)\s*$/, '')}`,
              (e.kinds || []).map((k) => KIND_LABEL[k]).join(', ')].filter(Boolean).join(' · ')}</small>
            ${(e.events || []).length > 0 && html`<small class="cal-events">${e.events.map((u) =>
              `${u.gender === 'W' ? '♀' : u.gender === 'M' ? '♂' : u.gender} ${u.events.join(', ')}`).join(' · ')}</small>`}
            ${e.competition_group && html`<small class="muted">${e.competition_group}</small>`}</span></span>
          <span class=${`tag ${TOP.includes(e.category) ? 'ok' : ''}`}>${e.category || '–'}</span>
        </div></li>`)}</ul>`)}
  </section>`;
}
