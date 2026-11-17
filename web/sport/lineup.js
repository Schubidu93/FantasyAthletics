// Aufstellung für den nächsten Spieltag (Team → Kader): Leichtathletik mit festen Positionen je Disziplin
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { rpc, useAction, Msg, leagueSlots, slotOk, SlotLabel } from '../lib.js';
import { fmtDeadline } from '../views/deadline.js';

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
