// Liga-Einstellungen der Leichtathletik: Startwerte, eigene Felder (Positionen je Disziplin), zusätzliche gespeicherte Werte.
import { html, useState } from '../vendor/preact-htm.js';
import { AREA_PRESETS, AREAS, BLOCK_LABEL, GENDER_LABEL, GROUP_LABEL, leagueSlots, positionGroups, positionSections, positionsFor, groupArea, RUN_GROUPS } from './lib.js';

/** Startwerte beim Anlegen einer Liga (zusätzlich zu den gemeinsamen) */
export const LEAGUE_DEFAULTS = {
  roster_size: 11, scoring_mode: 'lineup', draft_mode: 'snake', bid_seconds: 30,
  gender: 'mixed', lineup_mode: 'free', ...AREA_PRESETS.run, wildcards: 2,
};
export const SEASON_END = '12-31';
export const GENDER_OPTIONS = [['mixed', 'Mixed (Männer und Frauen)'], ['men', 'Nur Männer'], ['women', 'Nur Frauen']];
export const genderLabel = (g) => GENDER_LABEL[g] || '';
export const DRAFT_MODE_ORDER = ['snake', 'live', 'blind', 'offline'];

/** Wert ändern: beim Wechsel des Draft-Modus eine sinnvolle Zeit vorschlagen; bei „je Disziplin m + w“ den Kader vergrößern */
export function adjustSettings(f, k, v) {
  const next = { ...f, [k]: v,
    ...(k === 'draft_mode' && v === 'snake' && [15, 20].includes(+f.bid_seconds) ? { bid_seconds: 30 } : {}),
    ...(k === 'draft_mode' && v === 'live' && +f.bid_seconds === 30 ? { bid_seconds: 15 } : {}),
    ...(k === 'draft_mode' && v === 'blind' && +f.bid_seconds === 30 ? { bid_seconds: 20 } : {}) };
  // Bereiche geändert: Positionen passend vorschlagen (Voreinstellung bzw. nur noch gültige plus neue Bereiche)
  if (k === 'areas') {
    next.lineup_groups = areaPositions(f, v);
    // passende Ligagröße des Spiels vorschlagen (nur verkleinern)
    const sug = AREA_PRESETS[presetOf(v)]?.suggest || {};
    for (const [key, val] of Object.entries(sug)) if (+next[key] > val) next[key] = val;
  }
  const slots = leagueSlots(next).length;
  if (['lineup_mode', 'gender', 'wildcards', 'lineup_groups', 'areas'].includes(k) && +next.roster_size < slots) next.roster_size = slots + 3;
  return next;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
/** Welche Voreinstellung passt zu diesen Bereichen? 'run', 'all' oder 'custom' */
export const presetOf = (areas) => Object.keys(AREA_PRESETS).find((k) => sameSet(AREA_PRESETS[k].areas, areas)) || 'custom';
const posArea = (p) => groupArea(positionGroups(p)[0]);
function areaPositions(f, areas) {
  const preset = presetOf(areas);
  if (preset !== 'custom') return [...AREA_PRESETS[preset].lineup_groups];
  const old = (f.lineup_groups || []).filter((p) => areas.includes(posArea(p)));
  const added = areas.filter((a) => !(f.areas || []).includes(a) && a !== 'Gehen');
  const add = added.flatMap((a) => (a === 'Lauf' ? ['Mittel', 'Lang', 'Marathon'] : [a]));   // neuer Bereich: als Block
  return positionsFor(areas).filter((p) => old.includes(p) || add.includes(p));
}

/** Formularwerte aus der gespeicherten Liga (Admin → Einstellungen) */
export const settingsInit = (l) => ({ ...l });

/** Zusätzliche Werte für create_league / update_league_settings (Positionen nur vor dem Draft änderbar) */
export const settingsPayload = (f, { locked = false } = {}) => (locked ? {} : {
  lineup_mode: f.gender === 'mixed' ? f.lineup_mode : 'free', lineup_groups: f.lineup_groups, wildcards: +f.wildcards, areas: f.areas,
});

/** Felder zwischen „Anzahl Mitspieler“ und „Draft-Modus“: Disziplinen, Wertung, Kadergröße, Positionen */
export function SquadFields({ f, set, locked }) {
  const areas = f.areas || AREA_PRESETS.run.areas;
  // „Eigene Auswahl“ bleibt gewählt, auch wenn die Bereiche gerade einer Voreinstellung entsprechen
  const [custom, setCustom] = useState(presetOf(areas) === 'custom');
  const preset = custom ? 'custom' : presetOf(areas);
  const setAreas = (v) => v.length && set('areas')({ target: { value: v } });
  const positions = positionsFor(areas);
  const groups = f.lineup_groups || RUN_GROUPS;
  const toggleGroup = (g) => set('lineup_groups')({ target: { value: groups.includes(g) ? groups.filter((x) => x !== g) : positions.filter((x) => x === g || groups.includes(x)) } });
  const slots = leagueSlots({ ...f, lineup_mode: f.gender === 'mixed' ? f.lineup_mode : 'free', wildcards: +f.wildcards });
  return html`<label>Disziplinen
      <select value=${preset} disabled=${locked}
        onChange=${(e) => { setCustom(e.target.value === 'custom'); if (e.target.value !== 'custom') setAreas(AREA_PRESETS[e.target.value].areas); }}>
        ${Object.entries(AREA_PRESETS).map(([k, p]) => html`<option value=${k}>${p.label}</option>`)}<option value="custom">Eigene Auswahl</option>
      </select></label>
    ${AREA_PRESETS[preset]?.hint && html`<p class="muted small span2">${AREA_PRESETS[preset].hint}</p>`}
    ${preset === 'custom' && html`<div class="span2 group-pick">
      <span class="label-text">Bereiche der Liga</span>
      <div class="chips chips-grid">${AREAS.map((a) => html`<label class="check chip" key=${a}>
        <input type="checkbox" checked=${areas.includes(a)} disabled=${locked}
          onChange=${() => setAreas(areas.includes(a) ? areas.filter((x) => x !== a) : AREAS.filter((x) => x === a || areas.includes(x)))} /> ${a}</label>`)}</div>
      <p class="muted small">Nur Athleten dieser Bereiche können geholt werden, und nur Ergebnisse darin zählen.</p>
    </div>`}
    <label>Wertungsmodus
      <select value=${f.scoring_mode} onChange=${set('scoring_mode')}>
        <option value="lineup">Aufstellung pro Spieltag</option><option value="full">Gesamtkader zählt</option>
      </select></label>
    <label>Athleten pro Team (5–30)<input type="number" min="5" max="30" value=${f.roster_size} onInput=${set('roster_size')} disabled=${locked} /></label>
    ${f.scoring_mode === 'lineup' && html`
      ${f.gender === 'mixed' && html`<label>Positionen
        <select value=${f.lineup_mode} onChange=${set('lineup_mode')} disabled=${locked}>
          <option value="free">beliebig mit Mann oder Frau besetzen</option><option value="mf">je Disziplin ein Mann und eine Frau</option>
        </select></label>`}
      <label>Wildcards (beliebige Disziplin)<input type="number" min="0" max="6" value=${f.wildcards} onInput=${set('wildcards')} disabled=${locked} /></label>
      <div class="span2 group-pick">
        <span class="label-text">Disziplinen in der Aufstellung</span>
        <p class="muted small">Ein <strong>Block</strong> nimmt jeden Athleten des Bereichs auf, eine einzelne Disziplin nur ihre Spezialisten.</p>
        ${positionSections(areas).map((sec) => html`<div class="pos-section" key=${sec.area}>
          <span class="pos-area">${sec.area}</span>
          <div class="chips chips-grid">
            ${sec.blocks.map((g) => html`<label class="check chip chip-block" key=${g}>
              <input type="checkbox" checked=${groups.includes(g)} disabled=${locked} onChange=${() => toggleGroup(g)} /> ${BLOCK_LABEL[g]}</label>`)}
            ${sec.singles.map((g) => html`<label class="check chip" key=${g}>
              <input type="checkbox" checked=${groups.includes(g)} disabled=${locked} onChange=${() => toggleGroup(g)} /> ${GROUP_LABEL[g]}</label>`)}
          </div></div>`)}
        <p class="muted small"><strong>${slots.length} Positionen:</strong> ${f.gender === 'mixed' && f.lineup_mode === 'mf' ? 'je ein Mann und eine Frau in ' : 'je eine in '}${
          groups.length ? positions.filter((g) => groups.includes(g)).map((g) => GROUP_LABEL[g]).join(', ') : '–'}${
          +f.wildcards > 0 ? `, dazu ${+f.wildcards === 1 ? 'eine Wildcard' : `${+f.wildcards} Wildcards`} (beliebige Disziplin)` : ''}.
          ${slots.length > +f.roster_size ? html`<strong class="err-text"> Der Kader muss mindestens ${slots.length} Athleten haben.</strong>` : ''}</p>
      </div>`}`;
}
