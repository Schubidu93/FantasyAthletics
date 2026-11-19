// Spielregeln – allgemeine Regeln plus die Einstellungen der aktuellen Liga
import { html } from '../vendor/preact-htm.js';
import { draftCosts, fmtDate, q, sb, useLoad } from '../lib.js';
import { AREA_GROUPS, AREAS, discLabel, GENDER_LABEL, GROUP_LABEL, groupArea, leagueAreas, leagueSlots, positionGroups, RUN_GROUPS, slotLabel } from './lib.js';

const DRAFT = {
  live: 'Live-Auktion',
  blind: 'Blind-Auktion (verdeckte Gebote)',
  snake: 'Snake-Draft',
  offline: 'Offline-Draft (Kader trägt der Admin ein)',
};

const fmtNum = (n) => Number(n).toLocaleString('de-DE');
// Erklärung der Blöcke, die die Liga als Positionen nutzt (z. B. „Wurf = Kugel, Diskus, Hammer oder Speer“)
const blockText = (groups) => groups.filter((g) => positionGroups(g).length > 1)
  .map((g) => `${GROUP_LABEL[g]} = ${positionGroups(g).map((x) => GROUP_LABEL[x]).join(', ').replace(/, ([^,]+)$/, ' oder $1')}.`).join(' ');

// Disziplinfaktoren aus der Datenbank, zusammengefasst je Faktor (nur Bereiche der Liga, ohne Staffeln und Faktor 1):
// z. B. ×1,6 → „10.000 m, 10 km Straße, Cross, Berglauf“
const family = (name) => (/^Cross/.test(name) ? 'Cross' : /Mountain|Vertical/.test(name) ? 'Berglauf'
  : discLabel(name).replace(' (Halle)', ''));
function factorRows(disciplines, areas) {
  const by = new Map();
  for (const d of disciplines) {
    const f = Number(d.factor);
    if (!f || f === 1 || /Relay|Medley/.test(d.name) || !areas.includes(groupArea(d.event_group))) continue;
    if (!by.has(f)) by.set(f, []);
    const fam = family(d.name);
    if (!by.get(f).includes(fam)) by.get(f).push(fam);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]);
}

export function Rules({ c }) {
  const l = c.league;
  const cfg = useLoad(() => q(sb.from('scoring_config').select('*').eq('id', 1)).then((r) => r[0]), []).data;
  const disciplines = useLoad(() => q(sb.from('disciplines').select('name,factor,event_group')), []).data || [];
  const mf = Number(disciplines.find((d) => d.name === 'Marathon')?.factor || 1);
  // Spieljahr: ab 1. November das Folgejahr (wie game_year() in der Datenbank)
  const gy = cfg?.game_year || new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0);
  const two = l.transfer_mode === 'waiver_free';
  const lineup = l.scoring_mode === 'lineup';
  const slots = leagueSlots(l);
  const areas = leagueAreas(l);
  const runOnly = areas.length === 1 && areas[0] === 'Lauf';
  const areaText = runOnly ? 'nur Lauf (ab 800 m)' : areas.length === AREAS.length ? 'alle Disziplinen' : areas.join(', ');
  const thr = cfg ? cfg.perf_threshold : 1000;
  const auction = ['live', 'blind'].includes(l.draft_mode);
  const row = (k, v) => html`<tr><td>${k}</td><td>${v}</td></tr>`;
  const geherWildcard = areas.includes('Gehen') && !(l.lineup_groups || []).includes('Gehen');

  return html`<div class="stack rules">
    <section class="card">
      <h2>So funktioniert Athletics Fantasy</h2>
      <ol class="rule-steps">
        <li><strong>Team draften:</strong> ${l.roster_size} deutsche ${runOnly ? 'Läuferinnen und Läufer' : 'Leichtathletinnen und Leichtathleten'} pro Manager.</li>
        ${lineup ? html`<li><strong>Aufstellen:</strong> vor jedem Spieltag ${slots.length} Positionen besetzen.</li>` : html`<li><strong>Alle zählen:</strong> jeder Athlet im Kader punktet.</li>`}
        <li><strong>Punkte sammeln:</strong> für Leistung (WA-Punkte) und Platzierung jedes Ergebnisses.</li>
        <li><strong>Kader verbessern:</strong> per Waiver und Tausch. Am Saisonende gewinnt, wer die meisten Punkte hat.</li>
      </ol>
    </section>

    <section class="card">
      <h3>Diese Liga</h3>
      <table class="tbl rule-tbl"><tbody>
        ${row('Wertung', GENDER_LABEL[l.gender])}
        ${row('Disziplinen', areaText)}
        ${row('Saison', `${fmtDate(l.season_start)} – ${fmtDate(l.season_end)}`)}
        ${row('Mitspieler', `${c.managers.length} von max. ${l.max_managers}`)}
        ${row('Kader', `${l.roster_size} Athleten`)}
        ${row('Modus', lineup ? `Aufstellung, ${slots.length} Positionen` : 'Gesamtkader zählt')}
        ${lineup && row('Positionen', slots.map(slotLabel).join(', '))}
        ${row('Draft', DRAFT[l.draft_mode] + (auction ? ` · ${l.draft_order === 'ranking' ? 'nach WA-Punkten' : 'reihum nominieren'}` : ''))}
        ${l.draft_mode !== 'offline' && row(l.draft_mode === 'snake' ? 'Zeit pro Pick' : l.draft_mode === 'blind' ? 'Zeit pro Athlet' : 'Zeit pro Gebot', `${l.bid_seconds} Sekunden`)}
        ${draftCosts(l) ? row('Budget', `${l.budget} Punkte pro Manager`) : l.waiver_mode === 'faab' && row('FAAB-Budget', `${l.budget} Punkte für Waiver-Gebote`)}
        ${row('Transfers', two ? 'Waiver-Runde, dann freie Phase' : 'nur Waiver')}
        ${row('Waiver', l.waiver_mode === 'faab' ? 'FAAB (verdeckt bieten)' : 'Priorität (Letzter zuerst)')}
        ${l.keeper_count > 0 && row('Keeper', `bis ${l.keeper_count}, Preis Vorjahr + ${l.keeper_surcharge}`)}
      </tbody></table>
    </section>

    <details class="card rule-sec" open=${['setup', 'drafting'].includes(l.status)}>
      <summary><h3>Draft: ${DRAFT[l.draft_mode]}</h3></summary>
      <ul>
        ${l.draft_mode === 'snake' ? html`
          <li>Reihum je ein Athlet, jede Runde in umgekehrter Reihenfolge (1–2–3, 3–2–1). Startreihenfolge wird ausgelost.</li>
          <li>${l.bid_seconds} Sekunden pro Pick – sonst wird automatisch der beste freie Athlet gewählt.</li>
          <li>Athleten kosten nichts${l.waiver_mode === 'faab' ? `; die ${l.budget} Punkte bleiben für FAAB-Waiver` : ''}.</li>`
        : l.draft_mode === 'live' ? html`
          <li><strong>${l.budget} Budgetpunkte</strong> pro Manager. Athleten kommen ${l.draft_order === 'ranking' ? 'nach WA-Punkten' : 'reihum nominiert'} unter den Hammer.</li>
          <li>Jedes Gebot +1 oder mehr, die Uhr springt auf ${l.bid_seconds} Sekunden zurück. Läuft sie ab, gewinnt das Höchstgebot.</li>
          <li>Bietet niemand, ist der Athlet danach frei. Am Ende füllen alle reihum für je 1 Punkt auf.</li>`
        : l.draft_mode === 'blind' ? html`
          <li><strong>${l.budget} Budgetpunkte</strong> pro Manager. Athleten kommen ${l.draft_order === 'ranking' ? 'nach WA-Punkten' : 'reihum nominiert'} an die Reihe.</li>
          <li>Pro Athlet ${l.bid_seconds} Sekunden für ein <strong>verdecktes Gebot</strong>; das höchste gewinnt zu genau diesem Preis.</li>
          <li>Gleichstand: Stechen in Schritten von 1, bis keiner mehr erhöht.</li>
          <li>Bietet niemand, ist der Athlet danach frei.</li>`
        : html`<li>Offline – der Admin trägt die Kader samt Preisen ein.</li>`}
        ${auction && html`<li>Höchstgebot = Restbudget − (offene Plätze − 1), damit jeder Kader voll wird.</li>`}
        <li>Mit Draft-Termin startet der Draft automatisch${l.draft_mode !== 'offline' ? '; wer dran ist, bekommt eine Push-Nachricht' : ''}.</li>
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Athleten und Aufstellung</h3></summary>
      <ul>
        <li><strong>Wer ist dabei:</strong> Deutsche mit mindestens ${cfg ? cfg.pool_threshold : 975} WA-Punkten in der deutschen Topliste (dieses oder letztes Jahr).
          Wer für ein anderes Land startet, fällt raus.</li>
        <li><strong>Diese Liga:</strong> nur Athleten mit Schwerpunkt in ${areaText}${l.gender !== 'mixed' ? `, nur ${GENDER_LABEL[l.gender]}` : ''}.
          Es zählen aber <strong>alle</strong> ihre Ergebnisse${runOnly ? ' (z. B. auch die 400 m eines 800-m-Läufers)' : ''}.</li>
      </ul>
      <h4 class="rule-sub">Schwerpunkt-Disziplinen</h4>
      <table class="tbl rule-tbl"><tbody>
        ${AREAS.filter((a) => areas.includes(a)).map((a) => html`<tr key=${a}><td>${a}</td><td>${AREA_GROUPS[a].map((g) => GROUP_LABEL[g]).join(' · ')}</td></tr>`)}
      </tbody></table>
      <ul>
        <li>Schwerpunkt = Disziplin mit den meisten Punkten ${gy - 1} (gilt die ganze Saison ${gy}). Verwandtes zählt mit: Meile → 1500 m, 3000 m → 5000 m,
          Halbmarathon → Marathon, 60 m → 100 m${areas.includes('Lauf') ? '; Cross nach Länge' : ''}.</li>
        <li>Ohne Punkte: beste Leistung; ganz Neue: erste Leistung ab ${cfg?.new_group_threshold ?? 975} WA-Punkten.</li>
      </ul>
      <h4 class="rule-sub">Ränge in den Listen</h4>
      <table class="tbl rule-tbl"><tbody>
        ${row('1. Name', `Pool-Rang: nach Punkten ${gy - 1}, bei Gleichstand nach bester Leistung. Reihenfolge im Draft.`)}
        ${lineup && row(`#2 ${GROUP_LABEL[(l.lineup_groups || RUN_GROUPS)[0]] || ''}`, `Rang auf dieser Position der Liga${l.lineup_mode === 'mf' ? ', getrennt nach Männern und Frauen' : ''}.`)}
        ${lineup && l.wildcards > 0 && row('nur Wildcard', 'passt auf keine eigene Position, nur auf eine Wildcard.')}
      </tbody></table>
      ${lineup ? html`<h4 class="rule-sub">Aufstellung</h4>
        <ul>
          <li>${slots.length} Positionen: ${l.lineup_mode === 'mf' ? 'je Disziplin ein Mann und eine Frau' : 'je Position ein passender Athlet'}${l.wildcards > 0
            ? `, dazu ${l.wildcards} Wildcard${l.wildcards > 1 ? 's' : ''} (jede Disziplin der Liga)` : ''}. ${blockText(l.lineup_groups || [])}
            ${geherWildcard ? 'Geher nur auf Wildcards.' : ''}</li>
          <li>Änderbar bis zum Stichtag, dann fest. Ohne Änderung gilt die Aufstellung vom vorigen Spieltag (beim ersten: automatisch die besten passenden).</li>
          <li>Wird ein Athlet per Waiver ersetzt, rückt der neue nach, wenn er auf die Position passt.</li>
        </ul>` : ''}
    </details>

    <details class="card rule-sec">
      <summary><h3>Punkte</h3></summary>
      <div class="rule-formula">
        <div><strong>Punkte = (Leistung + Platzierung) × Faktor + Bonus</strong></div>
        <div>Leistung = (WA-Punkte − ${thr}) × ${cfg ? fmtNum(cfg.perf_factor) : '0,1'} <span class="muted">(nur über ${thr})</span></div>
        <div>Platzierung = WA-Platzierungspunkte × ${cfg ? fmtNum(cfg.placing_factor) : '0,2'}</div>
      </div>
      ${cfg && thr === 1000 && html`<p class="muted small">Beispiel: Marathon 2:09:43 (1135 WA-Punkte), keine Platzierungspunkte:
        135 × ${fmtNum(cfg.perf_factor)} × ${fmtNum(mf)} = <strong>${fmtNum(Math.round(135 * cfg.perf_factor * mf * 100) / 100)}</strong>.</p>`}
      <h4 class="rule-sub">Faktoren</h4>
      <p class="muted small">Höher, wo es nur wenige Wettkämpfe im Jahr gibt. Alles andere × 1.</p>
      <table class="tbl rule-tbl"><tbody>
        ${factorRows(disciplines, areas).map(([f, names]) => html`<tr key=${f}><td class="num">× ${fmtNum(f)}</td><td>${names.join(' · ')}</td></tr>`)}
      </tbody></table>
      <h4 class="rule-sub">Bonus</h4>
      <table class="tbl rule-tbl"><tbody>
        ${row(`+ ${cfg?.pb_points ?? 10}`, 'Persönliche Bestleistung („=PB“ halb)')}
        ${row(`+ ${cfg?.record_dr ?? 50} / ${cfg?.record_er ?? 100} / ${cfg?.record_wr ?? 200}`, 'Deutscher / Europa- / Weltrekord (eingestellt halb, nur der höchste)')}
      </tbody></table>
      <p class="muted small">Bestleistung: besser als alles davor (auch vor 2025; Halle, Bahn, Straße getrennt), ab ${thr} WA-Punkten, nicht beim ersten Start.
        Rekorde erkennt die App täglich an den Listen von World Athletics.</p>
      <h4 class="rule-sub">Platzierung</h4>
      <ul>
        <li>Nach Kategorie und Platz (World-Ranking-Regeln 2026): OW Olympia/WM · DF DL-Finale · GW Hallen-WM, Diamond League · GL EM · dann A–F.</li>
        <li>Vorläufe und Halbfinals nur bei OW, DF, GW, GL – und nur die letzte Runde vor dem Finale.</li>
      </ul>
      <h4 class="rule-sub">Sonderfälle</h4>
      <table class="tbl rule-tbl"><tbody>
        ${row('Mehrere Runden', 'Leistung und Platzierung nur der besten Runde; Bonus in jeder Runde.')}
        ${row('Finale in Läufen', 'Platz über alle Läufe, wie ein Finale.')}
        ${row('Meisterschaft im offenen Rennen', 'der bessere Wert aus Rennplatz und Meisterschaftsplatz (🏆 = Titel).')}
        ${areas.includes('Mehrkampf') && row('Mehrkampf-Einzeldisziplin', `Leistung ab ${thr} WA-Punkten und Bonus, keine Platzierung (die zählt im Gesamtergebnis).`)}
        ${row('Staffel', 'Leistung und Platzierung wie die Einzelstrecke, davon ¼ (4er) bzw. ⅓ (3er); kein Bestleistungs-Bonus.')}
        ${row('Zwischenzeit', 'nur Bestleistungs- und Rekord-Bonus.')}
        ${areas.includes('Lauf') && row('Cross', `fester Wert je Platz und Kategorie (z. B. GL-Sieg 1200) statt WA-Punkten, × ${cfg ? fmtNum(cfg.cross_factor) : '0,1'} × Länge (bis 3 km 1 · 6 km 1,5 · 12 km 2 · länger 2,5).`)}
      </tbody></table>
      <p class="muted small">Punkte zählen nur, solange der Athlet in deinem Kader${lineup ? ' und aufgestellt' : ''} ist. Korrekturen von World Athletics werden übernommen, bis der Spieltag eingefroren ist.</p>
    </details>

    <details class="card rule-sec">
      <summary><h3>Spieltage, Waiver und Tausch</h3></summary>
      <h4 class="rule-sub">Ablauf vor jedem Spieltag</h4>
      <table class="tbl rule-tbl"><tbody>
        ${two ? html`
          ${row('Waiver-Runde', 'bis eine Woche vor Spieltagstart (bei kurzen Spieltagen bis zur Hälfte des vorigen), dann Auswertung.')}
          ${row('Freie Phase', 'danach bis zum Stichtag: freie Athleten sofort holen und abgeben – wer zuerst kommt.')}
          ${row('Stichtag', `Ende des Vortags: Tausche ausgeführt, Kader${lineup ? ' und Aufstellung' : ''} fest.`)}`
        : html`
          ${row('Waiver', 'Anträge vom vorigen bis zum eigenen Stichtag.')}
          ${row('Stichtag', `Vortag 20 Uhr: Waiver und Tausche ausgeführt, Kader${lineup ? ' und Aufstellung' : ''} fest.`)}`}
        ${row('Spieltag', 'Wechsel gelten erst ab dem nächsten Spieltag. Punkte zwischen zwei Spieltagen verfallen.')}
        ${row('Danach', '7 Tage nach Ende eingefroren; bis dahin werden Korrekturen übernommen.')}
      </tbody></table>
      <h4 class="rule-sub">Waiver</h4>
      <ul>
        <li>Freien Athleten wählen und einen eigenen abgeben (Kader bleibt voll); mehrere Anträge in Wunschreihenfolge.</li>
        <li>${l.waiver_mode === 'faab'
          ? 'FAAB: verdeckt mit dem Restbudget bieten; Höchstgebot gewinnt, bei Gleichstand der schlechter Platzierte.'
          : 'Priorität: Tabellenletzter zuerst, höchstens ein Athlet pro Runde; vor dem ersten Spieltag umgekehrte Draft-Reihenfolge.'}</li>
        <li>${two ? 'In der Waiver-Runde Abgegebene sind ab der freien Phase wieder frei, in der freien Phase Abgegebene sofort.' : 'Abgegebene sind bis zum nächsten Stichtag gesperrt.'}</li>
        <li>Verletzte, gesperrte oder zurückgetretene Athleten (vom Admin markiert) sind sofort ersetzbar.</li>
      </ul>
      <h4 class="rule-sub">Tausch</h4>
      <ul>
        <li>Beide stimmen zu, dann 24 Stunden Veto für den Admin; ausgeführt zum nächsten Stichtag.</li>
        <li>Ungleich möglich (1 gegen 2): Wer mehr bekommt, gibt dafür eigene Athleten ab; wer weniger bekommt, füllt per Waiver auf.</li>
      </ul>
      <h4 class="rule-sub">Tabelle und Nachrichten</h4>
      <ul>
        <li>Gleichstand: mehr Spieltagssiege, dann bester Einzelspieltag${draftCosts(l) ? ', dann weniger Budget ausgegeben' : ''}.</li>
        <li>Push: „Neue Punkte“, Wochen-Zusammenfassung (montags 9 Uhr), Waiver-Ergebnisse und alles rund um Tausche.</li>
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Daten</h3></summary>
      <p class="muted small">Alles von World Athletics (deutsche Toplisten und Ergebnislisten), Ergebnisse ab 2025.</p>
      <table class="tbl rule-tbl"><tbody>
        ${row('Ergebnisse', 'stündlich 8–23 Uhr, sobald World Athletics sie veröffentlicht (kleine Wettkämpfe manchmal Tage später).')}
        ${row('Kontrolle', 'nachts alle Kader-Athleten komplett, die übrigen wöchentlich – Korrekturen werden übernommen.')}
        ${row('Athletenpool', 'täglich 6 Uhr, danach Bestleistungen und Rekorde.')}
        ${row('Kalender', 'täglich 6 Uhr: weltweit ab Gold Label, Europa ab A, Deutschland ab E.')}
        ${row('„Punkte 2026“', 'alle Wettkämpfe vom 1.1. bis 31.12.2026.')}
      </tbody></table>
      <h4 class="rule-sub">Was der Admin kann</h4>
      <ul>
        <li><strong>Athleten hinzufügen</strong> (z. B. unter der Pool-Grenze) – sie bleiben dauerhaft im Pool.</li>
        <li><strong>Nachtragen</strong>, was World Athletics nicht führt (z. B. RaceResult-Läufe, Staffeln 3 × 800 m): mit Zeit, Land, Kategorie und Quelle.
          Staffeln werden je Läufer über die Teilstrecke gewertet (Endzeit ÷ Läufer). Taucht das Ergebnis später bei WA auf, gilt WA.</li>
        <li><strong>Punkte korrigieren</strong> – jede Korrektur wird protokolliert.</li>
      </ul>
    </details>
  </div>`;
}
