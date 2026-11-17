// Liga-Einstellungen der Leichtathletik: Startwerte, eigene Felder (Positionen je Disziplin), zusätzliche gespeicherte Werte.
import { html } from '../vendor/preact-htm.js';
import { GENDER_LABEL, GROUP_LABEL, GROUPS, leagueSlots } from './lib.js';

/** Startwerte beim Anlegen einer Liga (zusätzlich zu den gemeinsamen) */
export const LEAGUE_DEFAULTS = {
  roster_size: 11, scoring_mode: 'lineup', draft_mode: 'snake', bid_seconds: 30,
  gender: 'mixed', lineup_mode: 'free', lineup_groups: [...GROUPS], wildcards: 2,
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
  const slots = leagueSlots(next).length;
  if (['lineup_mode', 'gender', 'wildcards', 'lineup_groups'].includes(k) && +next.roster_size < slots) next.roster_size = slots + 3;
  return next;
}

/** Formularwerte aus der gespeicherten Liga (Admin → Einstellungen) */
export const settingsInit = (l) => ({ ...l });

/** Zusätzliche Werte für create_league / update_league_settings (Positionen nur vor dem Draft änderbar) */
export const settingsPayload = (f, { locked = false } = {}) => (locked ? {} : {
  lineup_mode: f.gender === 'mixed' ? f.lineup_mode : 'free', lineup_groups: f.lineup_groups, wildcards: +f.wildcards,
});

/** Felder zwischen „Anzahl Mitspieler“ und „Draft-Modus“: Wertung, Kadergröße, Positionen */
export function SquadFields({ f, set, locked }) {
  const groups = f.lineup_groups || GROUPS;
  const toggleGroup = (g) => set('lineup_groups')({ target: { value: groups.includes(g) ? groups.filter((x) => x !== g) : GROUPS.filter((x) => x === g || groups.includes(x)) } });
  const slots = leagueSlots({ ...f, lineup_mode: f.gender === 'mixed' ? f.lineup_mode : 'free', wildcards: +f.wildcards });
  return html`<label>Wertungsmodus
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
        <div class="chips chips-grid">${GROUPS.map((g) => html`<label class="check chip" key=${g}>
          <input type="checkbox" checked=${groups.includes(g)} disabled=${locked} onChange=${() => toggleGroup(g)} /> ${GROUP_LABEL[g]}</label>`)}</div>
        <p class="muted small"><strong>${slots.length} Positionen:</strong> ${f.gender === 'mixed' && f.lineup_mode === 'mf' ? 'je ein Mann und eine Frau in ' : 'je eine in '}${
          groups.length ? GROUPS.filter((g) => groups.includes(g)).map((g) => GROUP_LABEL[g]).join(', ') : '–'}${
          +f.wildcards > 0 ? `, dazu ${+f.wildcards === 1 ? 'eine Wildcard' : `${+f.wildcards} Wildcards`} (beliebige Disziplin)` : ''}.
          ${slots.length > +f.roster_size ? html`<strong class="err-text"> Der Kader muss mindestens ${slots.length} Athleten haben.</strong>` : ''}</p>
      </div>`}`;
}
