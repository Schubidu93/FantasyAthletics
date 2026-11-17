// Spieltag-Vorschläge der Leichtathletik: Meisterschaften (aus dem WA-Kalender bzw. der DLV-Terminliste) bekommen
// eigene Spieltage; Großereignisse werden nicht auf zwei Spieltage verteilt.
import { html } from '../vendor/preact-htm.js';
import { iso, addDays, proposal } from '../views/admin/proposal.js';
import { fmtDate, q, sb, useLoad } from '../lib.js';

export const EMPTY_HINT = 'Noch keine Spieltage. Am schnellsten: unten „Spieltage automatisch vorschlagen“ → „Alle 2 Wochen“ oder „Saisonblöcke“ → „Alle anlegen“.';
export const NAME_PLACEHOLDER = 'z. B. Hallensaison';

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

// DM und Hallen-DM stehen oft erst spät im WA-Kalender → Termine aus anderen Quellen (DLV-Terminliste,
// Tabelle extra_calendar_events) ergänzen, solange WA für das Jahr keine hat. Geraten wird nichts.
export function withExtraChampionships(events, extras = []) {
  const out = [...events];
  for (const x of extras) {
    const label = championshipLabel(x);
    if (!label || events.some((e) => championshipLabel(e) === label && e.start_date.slice(0, 4) === x.start_date.slice(0, 4))) continue;
    out.push({ ...x, extra: true });
  }
  return out;
}
// Jahre der Saison, für die weder WA noch eine andere Quelle einen DM-/Hallen-DM-Termin kennt
export function missingChampionships(start, end, events) {
  const miss = [];
  for (let y = +start.slice(0, 4); y <= +end.slice(0, 4); y++) {
    for (const [label, month] of [['Hallen-DM', '02'], ['DM', '07']]) {
      if (`${y}-${month}-15` < start || `${y}-${month}-15` > end) continue;
      if (!events.some((e) => championshipLabel(e) === label && e.start_date.startsWith(String(y)))) miss.push(`${label} ${y}`);
    }
  }
  return miss;
}

// Meisterschaften → Blöcke Montag bis Sonntag der Meisterschaftswoche (überschneidende zusammengelegt)
function championshipBlocks(start, end, events) {
  const champs = [];
  for (const e of events) {
    const label = championshipLabel(e);
    if (!label) continue;
    const s = mondayOnOrBefore(e.start_date < start ? start : e.start_date);
    const t = sundayOnOrAfter((e.end_date || e.start_date) > end ? end : (e.end_date || e.start_date));
    const prev = champs.find((c) => s <= c.ends_on && t >= c.starts_on);
    if (prev) {
      if (!prev.name.split(' + ').includes(label)) prev.name += ` + ${label}`;
      prev.starts_on = s < prev.starts_on ? s : prev.starts_on; prev.ends_on = t > prev.ends_on ? t : prev.ends_on;
      prev.ev_start = e.start_date < prev.ev_start ? e.start_date : prev.ev_start;
      prev.ev_end = (e.end_date || e.start_date) > prev.ev_end ? (e.end_date || e.start_date) : prev.ev_end;
    } else champs.push({ name: label, starts_on: s < start ? start : s, ends_on: t > end ? end : t, champ: true,
      ev_start: e.start_date, ev_end: e.end_date || e.start_date });
  }
  return champs.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

// Meisterschaften in einen anderen Vorschlag einbauen: eigener Spieltag, die übrigen Spieltage werden drumherum gekürzt.
// onlyIfSplit: nur, wenn die Meisterschaft sonst auf zwei Spieltage fiele (Wöchentlich).
export function withChampionshipMatchdays(list, start, end, events, { onlyIfSplit = false, renumber = null } = {}) {
  let champs = championshipBlocks(start, end, events);
  const over = (a, b) => a.starts_on <= b.ends_on && a.ends_on >= b.starts_on;
  if (onlyIfSplit) champs = champs.filter((c) => {
    const ev = { starts_on: c.ev_start, ends_on: c.ev_end };
    return list.filter((m) => over(m, ev)).length > 1;
  });
  let out = list.map((m) => ({ ...m }));
  for (const c of champs) {
    out = out.flatMap((m) => {
      if (m.champ || !over(m, c)) return [m];
      const parts = [];
      if (m.starts_on < c.starts_on) parts.push({ ...m, ends_on: addDays(c.starts_on, -1) });
      if (m.ends_on > c.ends_on) parts.push({ ...m, starts_on: addDays(c.ends_on, 1) });
      return parts;
    });
    out.push(c);
    out.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  }
  // Reste unter 4 Tagen dem angrenzenden normalen Spieltag zuschlagen
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.champ || days(m.starts_on, m.ends_on) >= 4) continue;
    const prev = out[i - 1], next = out[i + 1];
    if (prev && !prev.champ && addDays(prev.ends_on, 1) === m.starts_on) { prev.ends_on = m.ends_on; out.splice(i--, 1); }
    else if (next && !next.champ && addDays(m.ends_on, 1) === next.starts_on) { next.starts_on = m.starts_on; out.splice(i--, 1); }
  }
  if (renumber) { let n = 0; for (const m of out) if (!m.champ) m.name = `${renumber} ${++n}`; }
  // gleicher Name zweimal (z. B. „Juli“ vor und nach der DM) → „Juli I“, „Juli II“
  const count = {};
  for (const m of out) if (!m.champ) count[m.name] = (count[m.name] || 0) + 1;
  const seen = {};
  for (const m of out) if (!m.champ && count[m.name] > 1) m.name = `${m.name} ${['I', 'II', 'III', 'IV'][seen[m.name] = (seen[m.name] || 0) + 1, seen[m.name] - 1]}`;
  return out.map(({ champ, ev_start, ev_end, ...m }) => m);
}

export function monthlyProposal(start, end, events = []) {
  // 1. Meisterschaften → eigene Spieltage (zusammengelegt, wenn sie sich überschneiden)
  const champs = championshipBlocks(start, end, events);
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
  return out.map(({ champ, ev_start, ev_end, ...m }) => m);
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

/** Knöpfe und Hinweise für „Spieltage automatisch vorschlagen“ (Admin → Spieltage) */
export function MatchdayProposals({ c, setGen }) {
  // Großereignisse aus dem Kalender, die nicht auf zwei Spieltage verteilt werden sollen
  const big = useLoad(async () => (await q(sb.from('calendar_events').select('name,category,country,start_date,end_date')
    .gte('end_date', c.league.season_start).lte('start_date', c.league.season_end)))
    .filter((e) => ['OW', 'DF', 'GW', 'GL'].includes(e.category) || championshipLabel(e)), [c.league.id]);
  const extra = useLoad(async () => await q(sb.from('extra_calendar_events').select('name,start_date,end_date,source_url')
    .gte('start_date', c.league.season_start).lte('start_date', c.league.season_end)), [c.league.id]);
  const events = withExtraChampionships(big.data || [], extra.data || []);
  const missing = missingChampionships(c.league.season_start, c.league.season_end, events);
  return html`<div class="row">
        <button class="primary" onClick=${() => setGen(monthlyProposal(c.league.season_start, c.league.season_end, events))}>Monatlich (Mo–So)</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(proposal('biweekly', c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events, { renumber: 'Spieltag' }))}>Alle 2 Wochen</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(seasonProposal(c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events))}>Saisonblöcke</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(proposal('monthly', c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events))}>Kalendermonate</button>
        <button onClick=${() => setGen(withChampionshipMatchdays(proposal('weekly', c.league.season_start, c.league.season_end), c.league.season_start, c.league.season_end, events, { onlyIfSplit: true, renumber: 'Woche' }))}>Wöchentlich</button>
      </div>
      <p class="muted small">Empfohlen: „Monatlich (Mo–So)“ – Olympia, WM, EM, Hallen-WM/-EM, Cross- und Straßen-WM/-EM, DM und Hallen-DM
        bekommen eigene Spieltage (Montag bis Sonntag der Meisterschaftswoche), dazwischen Spieltage von etwa einem Monat (Montag bis Sonntag).
        Andere Großereignisse werden nicht geteilt. Auch bei den anderen Vorschlägen bekommen diese Meisterschaften einen eigenen Spieltag
        (bei „Wöchentlich“ nur, wenn sie sonst auf zwei Wochen fielen). Stehen DM oder Hallen-DM noch nicht im WA-Kalender, gilt der Termin aus der DLV-Terminliste.</p>
      ${events.some((e) => e.extra) && html`<p class="muted small">Aus der DLV-Terminliste (noch nicht bei WA):
        ${events.filter((e) => e.extra).map((e, i) => html`${i ? ', ' : ''}<a href=${e.source_url} target="_blank" rel="noopener">${championshipLabel(e)} ${fmtDate(e.start_date)}</a>`)}</p>`}
      ${big.data && extra.data && missing.length > 0 && html`<p class="muted small">Termin noch unbekannt: ${missing.join(', ')} – Claude kann ihn einmalig beim DLV nachschlagen und eintragen.</p>`}`;
}
