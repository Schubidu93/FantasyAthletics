// Aufstellung für den nächsten Spieltag (Team → Kader): Leichtathletik mit festen Positionen je Disziplin
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { fmtDeadline } from '../views/deadline.js';
import { Msg, rpc, useAction } from '../lib.js';
import { leagueSlots, SlotLabel, slotOk } from './lib.js';

// Feste Positionen: je Disziplingruppe (ggf. getrennt nach Männern/Frauen) plus Wildcards
export function Lineup({ c }) {
  const md = c.nextMatchday;
  const slots = leagueSlots(c.league);
  const mine = c.active.filter((r) => r.manager_id === c.me.id).map((r) => c.riderMap[r.athlete_id]).filter(Boolean);
  const [sel, setSel] = useState(null);         // { slot: athlete_id }
  const a = useAction();
  useEffect(() => {
    if (!md) return;
    rpc('effective_lineup_slots', { p_matchday: md.id, p_manager: c.me.id })
      .then((rows) => setSel(Object.fromEntries(rows.filter((r) => mine.some((x) => x.id === r.athlete_id)).map((r) => [r.slot, r.athlete_id]))))
      .catch(() => setSel({}));
  }, [md?.id]);
  if (!md) return html`<section class="card"><h3>Aufstellung</h3><p class="muted">Kein kommender Spieltag angelegt.${c.isAdmin ? html` <a href=${`#/league/${c.league.id}/admin`}>Spieltag anlegen →</a>` : ''}</p></section>`;
  if (!sel) return null;
  const used = new Set(Object.values(sel).filter(Boolean));
  const filled = slots.filter((s) => sel[s]).length;
  const choose = (slot, slug) => {
    const next = { ...sel };
    for (const k of Object.keys(next)) if (next[k] === slug) delete next[k];   // Athlet wechselt die Position
    if (slug) next[slot] = slug; else delete next[slot];
    setSel(next);
  };
  return html`<section class="card">
    <h3>Aufstellung für ${md.name}</h3>
    <p class="muted small">${slots.length} Positionen: je Disziplin${c.league.lineup_mode === 'mf' ? ' ein Mann und eine Frau' : ''}, Wildcards nehmen jede Disziplin.
      Änderbar bis <strong>${fmtDeadline(md.deadline)}</strong>, danach ist sie für ${md.name} fest. Ohne neue Eingabe gilt die letzte Aufstellung.</p>
    <ul class="list compact lineup">${slots.map((slot) => {
      const options = mine.filter((r) => slotOk(slot, r));
      return html`<li key=${slot}>
        <span class="slot-name"><${SlotLabel} slot=${slot} /></span>
        <select value=${sel[slot] || ''} onChange=${(e) => choose(slot, e.target.value)}>
          <option value="">– leer –</option>
          ${options.map((r) => html`<option value=${r.id}>${r.name}${used.has(r.id) && sel[slot] !== r.id ? ' (andere Position)' : ''}</option>`)}
        </select></li>`;
    })}</ul>
    ${filled < slots.length && html`<p class="muted small">Für leere Positionen fehlt dir ein passender Athlet – hol dir einen per Waiver.</p>`}
    <div class="row">
      <button class="primary" disabled=${a.busy}
        onClick=${() => a.run(() => rpc('set_lineup', { p_matchday: md.id, p_lineup: sel }), 'Aufstellung gespeichert.')}>
        Speichern (${filled}/${slots.length})</button>
    </div>
    <${Msg} msg=${a.msg} />
  </section>`;
}

/** Kader im Draft nach den Positionen der Liga (vor dem Draft leer): jeder Pick füllt die erste freie passende Position
 *  (erst Disziplin, dann Wildcard), danach die Reserveplätze; offene Plätze sind hervorgehoben */
export function DraftRoster({ c, managerId }) {
  const lineup = c.league.scoring_mode === 'lineup';
  const slots = lineup ? leagueSlots(c.league) : [];
  const reserve = Math.max(0, c.league.roster_size - slots.length);
  const mine = c.active.filter((r) => r.manager_id === managerId);   // in Pick-Reihenfolge
  const at = {};
  const place = (r, wild) => {
    const s = slots.find((x) => !at[x] && x.startsWith('WC') === wild && slotOk(x, c.riderMap[r.athlete_id]));
    if (s) at[s] = r;
    return !!s;
  };
  const extra = mine.filter((r) => !place(r, false)).filter((r) => !place(r, true));
  const rows = [...slots.map((s) => [s, at[s], html`<${SlotLabel} slot=${s} />`]),
    ...Array.from({ length: Math.max(reserve, extra.length) }, (_, i) => [`R${i}`, extra[i], lineup ? `Reserve ${i + 1}` : `Platz ${i + 1}`])];
  const name = (r) => c.riderMap[r.athlete_id]?.name || r.athlete_id;
  const open = rows.filter((x) => !x[1]).length;
  return html`<p class="muted small">${open > 0 ? `Noch ${open} von ${rows.length} Plätzen offen.` : 'Kader komplett.'}</p>
    <ul class="list compact lineup">${rows.map(([k, r, label]) => html`<li key=${k} class=${r ? '' : 'slot-open'}>
      <span class="slot-name">${label}</span><span>${r ? name(r) : 'offen'}</span></li>`)}</ul>`;
}
