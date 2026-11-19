// Leichtathletik-Helfer: Disziplingruppen und Positionen, Bezeichnungen, Links zu World Athletics, Abzeichen,
// Staffeln für Nachträge, Rücksprung zum Athletenfenster
import { html } from '../vendor/preact-htm.js';
import { openRider } from '../lib.js';

// Disziplingruppen (Schwerpunkt-Disziplin eines Athleten) je Bereich – wie _group_area in der Datenbank
export const AREA_GROUPS = {
  Lauf: ['800', '1500', '5000', '10000', 'Marathon', 'Hindernis'],
  Sprint: ['100', '200', '400'],
  Hürden: ['Kurzhürden', 'Langhürden'],
  Sprung: ['Hochsprung', 'Stabhochsprung', 'Weitsprung', 'Dreisprung'],
  Wurf: ['Kugel', 'Diskus', 'Hammer', 'Speer'],
  Mehrkampf: ['Mehrkampf'],
  Gehen: ['Gehen'],
};
export const AREAS = Object.keys(AREA_GROUPS);
export const RUN_GROUPS = AREA_GROUPS.Lauf;
export const GROUPS = AREAS.flatMap((a) => AREA_GROUPS[a]);
export const GROUP_LABEL = { 800: '800 m', 1500: '1500 m', 5000: '5000 m', 10000: '10.000 m', Marathon: 'Marathon', Hindernis: 'Hindernis',
  100: '100 m', 200: '200 m', 400: '400 m', Kurzhürden: 'Kurzhürden', Langhürden: '400 m Hürden',
  Hochsprung: 'Hochsprung', Stabhochsprung: 'Stabhochsprung', Weitsprung: 'Weitsprung', Dreisprung: 'Dreisprung',
  Kugel: 'Kugelstoßen', Diskus: 'Diskuswurf', Hammer: 'Hammerwurf', Speer: 'Speerwurf', Mehrkampf: 'Mehrkampf', Gehen: 'Gehen',
  Mittel: 'Mittelstrecke', Lang: 'Langstrecke', Sprint: 'Sprint', Hürden: 'Hürden', Sprung: 'Sprung', Wurf: 'Wurf' };
export const groupArea = (g) => AREAS.find((a) => AREA_GROUPS[a].includes(g)) || null;
export const riderGroup = (r) => (r ? r.group_override || r.event_group : null);
export const leagueAreas = (l) => l?.areas || ['Lauf'];
/** Gruppen, die die Liga spielt (Filter, Auswahl) */
export const leagueGroups = (l) => GROUPS.filter((g) => leagueAreas(l).includes(groupArea(g)));
/** Darf in dieser Liga geholt werden? Im Pool und in einem Bereich der Liga (wie _eligible in der Datenbank) */
export const eligible = (r, l) => r?.pool_rank != null && (!groupArea(riderGroup(r)) || leagueAreas(l).includes(groupArea(riderGroup(r))));

// Positionen: jede Gruppe für sich oder ein Block mehrerer Gruppen – wie _position_groups in der Datenbank:
// „Mittel“ (800/1500), „Lang“ (5000/10.000/Hindernis) und Sprint, Hürden, Sprung, Wurf (alle Gruppen des Bereichs)
const BLOCKS = { Mittel: ['800', '1500'], Lang: ['5000', '10000', 'Hindernis'],
  Sprint: AREA_GROUPS.Sprint, Hürden: AREA_GROUPS.Hürden, Sprung: AREA_GROUPS.Sprung, Wurf: AREA_GROUPS.Wurf };
export const positionGroups = (p) => BLOCKS[p] || [p];
/** Wählbare Positionen je Bereich: zuerst die Blöcke (fassen mehrere Disziplinen zusammen), dann die einzelnen Disziplinen */
export const positionSections = (areas) => AREAS.filter((a) => areas.includes(a)).map((a) => ({
  area: a,
  blocks: a === 'Lauf' ? ['Mittel', 'Lang'] : AREA_GROUPS[a].length > 1 ? [a] : [],
  singles: AREA_GROUPS[a],
}));
/** Alle wählbaren Positionen für diese Bereiche (Reihenfolge wie in der Auswahl) */
export const positionsFor = (areas) => positionSections(areas).flatMap((x) => [...x.blocks, ...x.singles]);
/** Bezeichnung eines Blocks in der Auswahl, z. B. „Mittelstrecke (800/1500 m)“, „alle Sprünge“ */
export const BLOCK_LABEL = { Mittel: 'Mittelstrecke (800/1500 m)', Lang: 'Langstrecke (5000 m–Hindernis)',
  Sprint: 'alle Sprints', Hürden: 'alle Hürden', Sprung: 'alle Sprünge', Wurf: 'alle Würfe' };
/** Spiele: Bereiche und vorgeschlagene Positionen. Ein Bereich allein = je Disziplin eine Position; alle = Blöcke
 *  (Gehen nur über Wildcards). suggest: passende Ligagröße (im Wurf gibt es nur wenige Athleten) */
export const AREA_PRESETS = {
  all: { label: 'Alle Disziplinen', areas: [...AREAS], lineup_groups: ['Sprint', 'Hürden', 'Mittel', 'Lang', 'Marathon', 'Sprung', 'Wurf', 'Mehrkampf'] },

  run: { label: 'Nur Lauf (ab 800 m)', areas: ['Lauf'], lineup_groups: [...AREA_GROUPS.Lauf] },
  sprint: { label: 'Sprint und Hürden', areas: ['Sprint', 'Hürden'], lineup_groups: [...AREA_GROUPS.Sprint, ...AREA_GROUPS.Hürden] },
  jump: { label: 'Nur Sprung', areas: ['Sprung'], lineup_groups: [...AREA_GROUPS.Sprung] },
  throw: { label: 'Nur Wurf', areas: ['Wurf'], lineup_groups: [...AREA_GROUPS.Wurf], suggest: { max_managers: 6, roster_size: 7 },
    hint: 'Im Wurf gibt es nur wenige deutsche Spitzenathleten (z. B. etwa 8 Hammerwerfer je Geschlecht) – empfohlen: höchstens 6 Mitspieler und kleine Kader.' },
};
export const GENDER_LABEL = { men: 'Männer', women: 'Frauen', mixed: 'Mixed' };

// Positionen der Aufstellung (wie league_slots in der Datenbank): 800, 1500 … bzw. 800:M, 800:W …, dann WC1, WC2 …
export function leagueSlots(l) {
  const groups = l.lineup_groups || RUN_GROUPS;
  const out = l.lineup_mode === 'mf' ? groups.flatMap((g) => [`${g}:M`, `${g}:W`]) : [...groups];
  for (let i = 1; i <= (l.wildcards ?? 0); i++) out.push(`WC${i}`);
  return out;
}
export function slotLabel(slot) {
  const [g, sex] = slot.split(':');
  const base = /^WC(\d+)$/.test(g) ? `Wildcard ${g.slice(2)}` : GROUP_LABEL[g] || g;
  return sex ? `${base} ${sex === 'M' ? 'M' : 'F'}` : base;
}
// Links zu World Athletics: Athletenprofil (Pfad aus Land und Name, entscheidend ist die ID am Ende) und Ergebnisse
const WA_COUNTRY = { GER: 'germany', AUT: 'austria', SUI: 'switzerland' };
export function waAthleteUrl(r) {
  const id = r.wa_id || String(r.id || '').replace(/^wa-/, '');
  const slug = (r.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `https://worldathletics.org/athletes/${WA_COUNTRY[r.nation] || 'germany'}/${slug}-${id}`;
}
export const waResultUrl = (competitionId, eventId) =>
  `https://worldathletics.org/competition/calendar-results/results/${competitionId}${eventId ? `?eventId=${eventId}` : ''}`;
// Geschlecht als kleines farbiges Abzeichen: blaues M, rosa F (g = 'men'/'women' oder 'M'/'W')
export const SexBadge = ({ g }) => {
  const f = g === 'women' || g === 'W' || g === 'F';
  return html`<span class=${`badge ${f ? 'b-f' : 'b-m'}`} title=${f ? 'Frauen' : 'Männer'}>${f ? 'F' : 'M'}</span>`;
};
// WA-Wettkampfkategorie als farbiges Abzeichen (wie im Kalender-Widget): DL/OW/DF/GW lila, GL blau, A grün, sonst grau
const CAT_CLASS = { OW: 'b-top', DF: 'b-top', GW: 'b-top', DL: 'b-top', GL: 'b-gl', A: 'b-a' };
export const CatBadge = ({ cat }) => (cat ? html`<span class=${`badge ${CAT_CLASS[cat] || 'b-low'}`} title="Kategorie bei World Athletics">${cat}</span>` : '');
// Sortierschlüssel für Disziplinen: Strecke in Metern (800 m < 1500 m < Meile < … < Marathon)
export function discMeters(label) {
  const s = String(label || '');
  if (/Halbmarathon|Half Marathon/i.test(s)) return 21097;
  if (/Marathon/i.test(s)) return 42195;
  if (/Meile|Mile/i.test(s)) return 1609;
  const km = s.match(/([\d.,]+)\s*km/i);
  if (km) return parseFloat(km[1].replace(',', '.')) * 1000;
  const m = s.match(/([\d.]+)\s*(m\b|Metres)/);
  return m ? parseFloat(m[1].replace('.', '')) : 1e6;
}
// Reihenfolge der Läufe: Vorläufe, Viertel-, Halbfinale, Finale; jeweils 1, 2, 3 …
export function raceOrder(r) {
  const m = String(r || '').match(/^(R|Q|H|QF|SF|F)(\d*)$/);
  if (!m) return 500;
  return { R: 0, Q: 50, H: 100, QF: 200, SF: 300, F: 400 }[m[1]] + (+m[2] || 0);
}
// Positionsname mit Geschlechts-Kennzeichen
export function SlotLabel({ slot }) {
  const [g, sex] = slot.split(':');
  return html`${slotLabel(g)}${sex ? html` <${SexBadge} g=${sex} />` : ''}`;
}
// Darf der Athlet auf diese Position? (gleiche Regel wie _slot_ok in der Datenbank)
export function slotOk(slot, r) {
  if (!r) return false;
  const [g, sex] = slot.split(':');
  if (sex === 'M' && r.gender !== 'men') return false;
  if (sex === 'W' && r.gender !== 'women') return false;
  return g.startsWith('WC') || positionGroups(g).includes(riderGroup(r));
}

// Disziplinnamen von World Athletics kurz und deutsch: "1500 Metres Short Track" → "1500 m (Halle)"
const DISC = [[/^10,000 Metres/, '10.000 m'], [/ Kilometres Race Walk/, ' km Gehen'], [/^High Jump/, 'Hochsprung'],
  [/^Pole Vault/, 'Stabhochsprung'], [/^Long Jump/, 'Weitsprung'], [/^Triple Jump/, 'Dreisprung'], [/^Shot Put/, 'Kugelstoßen'],
  [/^Discus Throw/, 'Diskuswurf'], [/^Hammer Throw/, 'Hammerwurf'], [/^Javelin Throw/, 'Speerwurf'], [/^Decathlon/, 'Zehnkampf'],
  [/^Heptathlon/, 'Siebenkampf'], [/^Pentathlon/, 'Fünfkampf'], [/ Metres Steeplechase/, ' m Hindernis'], [/ Metres Hurdles/, ' m Hürden'],
  [/ Metres/, ' m'], [/^Mile Road$/, 'Meile Straße'], [/^Mile/, 'Meile'], [/^2 Miles/, '2 Meilen'], [/^10 Miles Road/, '10 Meilen'],
  [/^Half Marathon/, 'Halbmarathon'], [/ Kilometres Road/, ' km Straße'], [/^Cross Country Relay/, 'Cross-Staffel'],
  [/^Cross Country/, 'Cross'], [/ Short Track$/, ' (Halle)'], [/ Relay/, ' Staffel'], [/ Race Walk/, ' Gehen'],
  [/^Mountain Running /, 'Berglauf '], [/^Mountain Classic/, 'Berglauf']];
export const discLabel = (d) => DISC.reduce((t, [re, rep]) => t.replace(re, rep), d || '');
// Cross-Distanz aus dem Wettkampfnamen ("… - XC 7.5km") wie cross_km in der Datenbank
export const crossKm = (competition) => {
  const m = (competition || '').match(/XC\s*([0-9]+(?:[.,][0-9]+)?)\s*km/i);
  return m ? Number(m[1].replace(',', '.')) : null;
};
// Disziplin mit Cross-Distanz, z. B. "Cross 7,5 km"
export const discWithKm = (d, competition) => {
  const km = /^Cross Country/.test(d || '') ? crossKm(competition) : null;
  return discLabel(d) + (km ? ` ${km.toLocaleString('de-DE')} km` : '');
};
// Lauf bzw. Runde laut WA: F, F1, SF2, H3, QF1, Q (Qualifikation im Sprung/Wurf) …
export function raceLabel(r) {
  const m = (r || '').match(/^(F|SF|QF|H|R|Q)(\d*)$/);
  if (!m) return r || '';
  const name = { F: 'Finale', SF: 'Halbfinale', QF: 'Viertelfinale', H: 'Vorlauf', R: 'Lauf', Q: 'Qualifikation' }[m[1]];
  return m[2] ? `${name} ${m[2]}` : name;
}

// Staffel-Nachträge
export const RELAYS = { '3x800': { label: '3 × 800 m', leg: '800 Metres', legs: 3 }, '3x1000': { label: '3 × 1000 m', leg: '1000 Metres', legs: 3 },
  '4x400': { label: '4 × 400 m', leg: '400 Metres', legs: 4 } };

// Sprung aus dem Athletenfenster (Wettkampf, Topliste): Athlet merken, damit die Seite „Zurück zu …“ anbieten kann
let cameFrom = null;
export const rememberAthlete = (slug, name) => { cameFrom = { slug, name, hash: null }; };
export function BackToAthlete() {
  if (!cameFrom) return null;
  // nur auf der ersten Seite nach dem Sprung anzeigen
  if (cameFrom.hash === null) cameFrom.hash = location.hash;
  if (cameFrom.hash !== location.hash) return null;
  const { slug, name } = cameFrom;
  return html`<a href="#" class="small-link" onClick=${(e) => { e.preventDefault(); cameFrom = null; openRider(slug); }}>← Zurück zu ${name}</a>`;
}

