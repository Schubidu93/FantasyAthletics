// Spieltag-Vorschläge der Leichtathletik (reine Berechnung, ohne Oberfläche – getestet in tests/matchdays.test.ts):
// Meisterschaften bekommen eigene Spieltage; Großereignisse werden nicht auf zwei Spieltage verteilt. Alles hängt von den
// Bereichen der Liga ab (z. B. Cross-EM nur in reinen Laufligen, ohne Lauf keine leeren Herbst- und Wintermonate).
import { iso, addDays } from '../views/admin/proposal.js';

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

// Meisterschaften mit eigenem Spieltag (erkannt am Namen im WA-Kalender); Nachwuchs, Teams und Staffeln nicht.
// Dritte Spalte: Fachmeisterschaft nur für diese Bereiche – eigener Spieltag nur, wenn die Liga nichts anderes spielt.
const CHAMPIONSHIPS = [
  ['Olympia', /olympic games/i],
  ['Hallen-WM', /world athletics indoor championships/i],
  ['Cross-WM', /world (athletics )?cross country championships/i, ['Lauf']],
  ['Straßen-WM', /world (athletics )?road running championships/i, ['Lauf']],
  ['WM', /world athletics championships/i],
  ['Hallen-EM', /european athletics indoor championships/i],
  ['Cross-EM', /european (athletics )?cross country championships/i, ['Lauf']],
  ['Straßen-EM', /european (running|road running) championships/i, ['Lauf']],
  ['EM', /european athletics championships/i],
  ['Mehrkampf-DM', /(german|deutsche).*(combined events|mehrkampf)/i, ['Mehrkampf']],
  ['Winterwurf-DM', /(german|deutsche).*(winter throw|winterwurf)/i, ['Wurf']],
  ['Hallen-DM', /(german|deutsche).*(indoor|hallen).*(championships|meisterschaften)/i],
  ['DM', /(german|deutsche) (athletics )?(championships|meisterschaften)/i],
];
const NOT_SENIOR_CHAMPS = /u\s?1[68]|u\s?2[03]|youth|junior|jugend|team|relays|staffel|masters|senioren|mountain|trail|10\s?km|half|marathon/i;
/** Meisterschaft mit eigenem Spieltag? areas = Bereiche der Liga (ohne: alle Meisterschaften) */
export const championshipLabel = (e, areas = null) => {
  if (NOT_SENIOR_CHAMPS.test(e.name)) return null;
  const c = CHAMPIONSHIPS.find(([, re]) => re.test(e.name));
  if (!c) return null;
  return !areas || !c[2] || areas.every((a) => c[2].includes(a)) ? c[0] : null;
};

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
function championshipBlocks(start, end, events, areas) {
  const champs = [];
  for (const e of events) {
    const label = championshipLabel(e, areas);
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
export function withChampionshipMatchdays(list, start, end, events, { onlyIfSplit = false, renumber = null, areas = null } = {}) {
  let champs = championshipBlocks(start, end, events, areas);
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

export function monthlyProposal(start, end, events = [], areas = null) {
  // 1. Meisterschaften → eigene Spieltage (zusammengelegt, wenn sie sich überschneiden)
  const champs = championshipBlocks(start, end, events, areas);
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
  // Ohne Lauf ruht die Saison von Oktober bis Dezember (keine Straßen-, Cross- und Marathonsaison) → ein Spieltag „Saisonpause“
  if (areas && !areas.includes('Lauf')) {
    const quiet = (m) => !m.champ && +m.ends_on.slice(5, 7) >= 10 && m.starts_on.slice(5) >= '09-25';
    for (let i = out.length - 1; i > 0; i--) {
      if (quiet(out[i - 1]) && quiet(out[i])) { out[i - 1].ends_on = out[i].ends_on; out.splice(i, 1); }
    }
    for (const m of out) if (quiet(m) && m.ends_on.slice(5) === '12-31') m.name = 'Saisonpause';
  }
  // gleiche Monatsnamen unterscheiden (z. B. „Juli I“, „Juli II“)
  const count = {};
  for (const m of out) if (!m.champ) count[m.name] = (count[m.name] || 0) + 1;
  const seen = {};
  for (const m of out) if (!m.champ && count[m.name] > 1) m.name = `${m.name} ${['I', 'II', 'III'][seen[m.name] = (seen[m.name] || 0) + 1, seen[m.name] - 1]}`;
  return out.map(({ champ, ev_start, ev_end, ...m }) => m);
}

// Saisonblöcke der Leichtathletik: Halle, Frühjahr (Straße/Cross, Winterwurf), Bahnsaison in Monatsblöcken
// (Meisterschaften meist im Juni bis August). Mit Lauf: Herbst mit Straßenläufen und Marathons, Winter mit Cross;
// ohne Lauf: September (Saisonende der Bahn) und danach Saisonpause.
export function seasonProposal(start, end, areas = null) {
  const y = start.slice(0, 4);
  const run = !areas || areas.includes('Lauf');
  const blocks = [['Hallensaison', `${y}-01-01`, `${y}-03-15`], ['Frühjahr', `${y}-03-16`, `${y}-04-30`],
    ['Mai', `${y}-05-01`, `${y}-05-31`], ['Juni', `${y}-06-01`, `${y}-06-30`], ['Juli', `${y}-07-01`, `${y}-07-31`],
    ['August', `${y}-08-01`, `${y}-08-31`],
    ...(run ? [['Herbst', `${y}-09-01`, `${y}-10-31`], ['Winter', `${y}-11-01`, `${y}-12-31`]]
      : [['September', `${y}-09-01`, `${y}-09-30`], ['Saisonpause', `${y}-10-01`, `${y}-12-31`]])];
  return blocks.map(([name, s, e]) => ({ name, starts_on: s < start ? start : s, ends_on: e > end ? end : e }))
    .filter((m) => m.starts_on <= m.ends_on);
}

