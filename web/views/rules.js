// Spielregeln – allgemeine Regeln plus die Einstellungen der aktuellen Liga
import { html } from '../vendor/preact-htm.js';
import { sb, q, useLoad, fmtDate, draftCosts, GENDER_LABEL, leagueSlots, slotLabel } from '../lib.js';

const DRAFT = {
  live: 'Live-Auktion',
  blind: 'Blind-Auktion (verdeckte Gebote)',
  snake: 'Snake-Draft',
  offline: 'Offline-Draft (Kader trägt der Admin ein)',
};

const fmtNum = (n) => Number(n).toLocaleString('de-DE');

export function Rules({ c }) {
  const l = c.league;
  const cfg = useLoad(() => q(sb.from('scoring_config').select('*').eq('id', 1)).then((r) => r[0]), []).data;
  const two = l.transfer_mode === 'waiver_free';
  const lineup = l.scoring_mode === 'lineup';
  const slots = leagueSlots(l);
  const extras = html`<li>Der Admin kann einen Draft-Termin festlegen – dann läuft für alle ein Countdown und der Draft startet automatisch.</li>
        ${l.draft_mode !== 'offline' && html`<li>Bist du an der Reihe${['live', 'blind'].includes(l.draft_mode) ? ' (Nominieren oder Auffüllen)' : ''}, bekommst du eine Push-Nachricht „Du bist dran“.</li>`}`;
  const row = (k, v) => html`<tr><td>${k}</td><td><strong>${v}</strong></td></tr>`;
  return html`<div class="stack rules">
    <section class="card">
      <h2>So funktioniert Runner Fantasy</h2>
      <p>Jeder Manager stellt ein Team aus deutschen Läuferinnen und Läufern zusammen. Für jedes Ergebnis seiner
        ${l.scoring_mode === 'lineup' ? 'aufgestellten ' : ''}Athleten gibt es Punkte – aus der Leistung (WA-Punkte) und der Platzierung.
        Wer am Saisonende die meisten Punkte hat, gewinnt die Liga.</p>
    </section>

    <section class="card">
      <h3>Einstellungen dieser Liga</h3>
      <table class="tbl"><tbody>
        ${row('Wertung', GENDER_LABEL[l.gender])}
        ${row('Saison', `${fmtDate(l.season_start)} – ${fmtDate(l.season_end)}`)}
        ${row('Mitspieler', `${c.managers.length} von max. ${l.max_managers}`)}
        ${row('Athleten pro Team', l.roster_size)}
        ${row('Wertungsmodus', l.scoring_mode === 'lineup' ? `Aufstellung: ${slots.length} Positionen` : 'Gesamtkader zählt')}
        ${lineup && row('Positionen', slots.map(slotLabel).join(', '))}
        ${row('Draft', DRAFT[l.draft_mode] + (['live', 'blind'].includes(l.draft_mode) ? ` · ${l.draft_order === 'ranking' ? 'Reihenfolge nach WA-Punkten' : 'reihum nominieren'}` : ''))}
        ${l.draft_mode !== 'offline' && row(l.draft_mode === 'snake' ? 'Zeit pro Pick' : l.draft_mode === 'blind' ? 'Zeit pro Athlet' : 'Zeit pro Gebot', `${l.bid_seconds} Sekunden`)}
        ${draftCosts(l) ? row('Budget', `${l.budget} Budgetpunkte pro Manager`) : l.waiver_mode === 'faab' && row('FAAB-Budget', `${l.budget} Punkte pro Manager für Waiver-Gebote`)}
        ${row('Transfers', two ? 'Waiver-Runde, danach freie Phase bis zum Stichtag' : 'nur Waiver bis zum Stichtag')}
        ${row('Waiver', l.waiver_mode === 'faab' ? 'FAAB – verdeckt mit dem Restbudget bieten' : 'Priorität – Tabellenletzter zuerst')}
        ${l.keeper_count > 0 && row('Keeper', `bis zu ${l.keeper_count} Athleten aus der Vorsaison, Preis Vorjahr + ${l.keeper_surcharge}`)}
      </tbody></table>
    </section>

    <details class="card rule-sec" open=${['setup', 'drafting'].includes(l.status)}>
      <summary><h3>Draft: ${DRAFT[l.draft_mode]}</h3></summary>
      ${l.draft_mode === 'live' ? html`<ul>
          <li>Jeder Manager hat <strong>${l.budget} Budgetpunkte</strong>. Die Athleten kommen ${l.draft_order === 'ranking' ? 'nach WA-Punkten (beste zuerst)' : 'reihum nominiert (Startgebot 1)'} unter den Hammer.</li>
          <li>Jedes Gebot muss das vorige um mindestens 1 übertreffen und setzt die Uhr auf ${l.bid_seconds} Sekunden zurück. Läuft sie ab, gewinnt das Höchstgebot.</li>
          <li>Höchstgebot = Restbudget − (offene Kaderplätze − 1), damit jeder Kader füllbar bleibt.</li>
          <li>Bietet niemand, wird der Athlet übersprungen und ist danach frei. Ist der Pool durch, füllen alle ihre Restplätze reihum für je 1 Punkt.</li>
          ${extras}
        </ul>`
      : l.draft_mode === 'blind' ? html`<ul>
          <li>Jeder Manager hat <strong>${l.budget} Budgetpunkte</strong>. Die Athleten kommen ${l.draft_order === 'ranking' ? 'nach WA-Punkten (beste zuerst)' : 'reihum nominiert'} an die Reihe.</li>
          <li>Pro Athlet haben alle <strong>${l.bid_seconds} Sekunden</strong> für ein <strong>verdecktes Gebot</strong>. Bis dahin kann man es ändern oder zurückziehen; haben alle geboten, geht es sofort weiter.</li>
          <li>Das höchste Gebot bekommt den Athleten zu genau diesem Preis. Danach werden alle Gebote offengelegt.</li>
          <li>Gleichstand: Stechen zwischen den Gleichauf-Bietern. Einer liegt vorn (reihum wechselnd); die anderen können um je 1 erhöhen. Erhöht niemand mehr innerhalb von ${l.bid_seconds} Sekunden oder reicht das Budget nicht, gewinnt der Vordere.</li>
          <li>Höchstgebot = Restbudget − (offene Kaderplätze − 1), damit jeder Kader füllbar bleibt.</li>
          <li>Bietet niemand, wird der Athlet übersprungen und ist danach frei.${l.draft_order === 'ranking' ? ' Ist der Pool durch, füllen alle ihre Restplätze reihum für je 1 Punkt.' : ''}</li>
          ${extras}
        </ul>`
      : l.draft_mode === 'snake' ? html`<ul>
          <li>Die Manager wählen reihum je einen Athleten; in jeder Runde dreht sich die Reihenfolge um (1–2–3 … 3–2–1). Die Reihenfolge wird beim Start ausgelost.</li>
          <li>Pro Pick gibt es ${l.bid_seconds} Sekunden. Läuft die Uhr ab, wird automatisch der beste freie Athlet nach WA-Punkten gewählt.</li>
          <li>Athleten kosten im Snake-Draft nichts${l.waiver_mode === 'faab' ? `; die ${l.budget} Budgetpunkte bleiben für FAAB-Waiver` : ''}.</li>
          ${extras}
        </ul>`
      : html`<ul><li>Der Draft findet offline statt. Der Admin trägt danach die Kader samt Preisen ein (oder lädt eine CSV hoch).</li>${extras}</ul>`}

    </details>

    <details class="card rule-sec">
      <summary><h3>Athletenpool und Aufstellung</h3></summary>
      <ul>
        <li><strong>Pool:</strong> deutsche Läuferinnen und Läufer, die in der DE-Topliste (Senioren) des aktuellen Jahres oder des Vorjahres
          in einer Laufdisziplin ab 800 m (inkl. Halle, Hindernis und Straße) mindestens ${cfg ? cfg.pool_threshold : 1000} WA-Punkte erreicht haben.
          ${l.gender !== 'mixed' ? `In dieser Liga nur ${GENDER_LABEL[l.gender]}.` : ''} Der Pool wird täglich aktualisiert; neue Athleten sind automatisch frei.</li>
        <li><strong>Disziplingruppe:</strong> 800 m, 1500 m, 5000 m, 10.000 m, Marathon oder Hindernis – nach der besten Toplistenleistung (z. B. Meile → 1500 m, 3000 m → 5000 m, Halbmarathon → Marathon).</li>
        ${lineup ? html`
          <li>Für jeden Spieltag stellst du bis zu ${slots.length} Athleten auf: ${l.lineup_mode === 'mf'
            ? 'je Disziplin einen Mann (♂) und eine Frau (♀)' : 'je Disziplin einen Athleten dieser Gruppe'}${l.wildcards > 0
            ? `, dazu ${l.wildcards} Wildcard${l.wildcards > 1 ? 's' : ''} mit Athleten jeder Disziplin` : ''}.</li>
          <li>Positionen ohne passenden Athleten bleiben leer. Bis zum Stichtag änderbar, danach ist die Aufstellung für diesen Spieltag fest.
            Stellst du nicht neu auf, gilt die Aufstellung vom vorigen Spieltag (beim ersten Spieltag: automatisch deine teuersten bzw. besten passenden Athleten).</li>
          <li>Wird ein Athlet per Waiver ersetzt, rückt der neue auf seine Position nach, wenn er dort passt – sonst bleibt sie leer.</li>`
        : html`<li>Es zählen <strong>alle Athleten deines Kaders</strong>.</li>`}
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Punkte</h3></summary>
      <ul>
        <li>Jedes Ergebnis bei World Athletics bringt
          <strong>Leistungspunkte</strong> = (WA-Punkte − ${cfg ? cfg.perf_threshold : 1000}) × ${cfg ? fmtNum(cfg.perf_factor) : 1} (nur über der Schwelle) plus
          <strong>Platzierungspunkte</strong> = WA-Platzierungspunkte × ${cfg ? fmtNum(cfg.placing_factor) : 1},
          beides mal dem <strong>Disziplinfaktor</strong> (z. B. 5000 m 1,3 · 10.000 m 1,6 · Halbmarathon 2 · Marathon 3 · Gehen und Sprintstaffeln 0).</li>
        <li><strong>Platzierungspunkte</strong> genau nach den World-Ranking-Regeln 2026 von World Athletics: abhängig von Wettkampfkategorie
          (OW = Olympia/WM, DF = Diamond-League-Finale, GW = Hallen-WM/Diamond League, GL = EM, A–F) und Platz.
          Eigene Tabellen für 800/1500 m, 5000 m/Hindernis, 10.000 m, Marathon und Straße; passt eine Disziplin zu mehreren Tabellen, zählt die bessere.</li>
        <li><strong>Vorläufe und Halbfinals</strong> bringen nur bei OW, DF, GW und GL Platzierungspunkte – und nur in der letzten Runde vor dem Finale:
          qualifiziert (Q oder q) = fester Wert, ausgeschieden = Gesamtplatz der Runde (erst alle Qualifizierten, dann die anderen nach Zeit).</li>
        <li><strong>Finals mit mehreren Läufen</strong> (z. B. 10.000 m in zwei Läufen): Platz über alle Läufe nach Zeit, gewertet wie ein Finale.</li>
        <li><strong>Cross:</strong> keine Leistungspunkte, nur Platzierungspunkte nach der WA-Cross-Tabelle × ${cfg ? fmtNum(cfg.cross_factor) : 0.1} × Disziplinfaktor.
          Berg- und Traillauf nutzen die Tabelle für 10 km Straße.</li>
        <li>Punkte zählen nur innerhalb eines Spieltags – für die Spieltage, in denen der Athlet in deinem Kader steht${lineup ? ' und aufgestellt ist' : ''}.</li>
        <li>Korrigiert World Athletics ein Ergebnis, wird das automatisch übernommen, solange der Spieltag nicht eingefroren ist.</li>
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Spieltage und Tabelle</h3></summary>
      <ul>
        <li>Der Admin legt Spieltage als Zeiträume fest (z. B. alle 2 Wochen oder Hallensaison, Frühjahr, Bahnsaison). Punkte zwischen zwei Spieltagen verfallen.
          Alle Spieltage stehen im Spielplan unter Liga → Spieltage.</li>
        ${two ? html`
        <li>Vor jedem Spieltag gibt es zwei Transferphasen:
          <ul>
            <li><strong>Waiver-Runde</strong> bis eine Woche vor Spieltagstart (bis Tagesende; ist der vorige Spieltag kürzer als 14 Tage, bis zu seiner Hälfte). Danach werden die Anträge ausgewertet.</li>
            <li><strong>Freie Phase</strong> danach bis zum Stichtag: freie Athleten sofort holen und abgeben, so oft du willst – wer zuerst kommt.</li>
            <li><strong>Stichtag</strong> (Standard: Ende des Vortags, also mit Spieltagstart): Tausche werden ausgeführt, Kader${lineup ? ' und Aufstellung' : ''} sind für den Spieltag fest.</li>
          </ul></li>`
        : html`
        <li>Jeder Spieltag hat einen <strong>Stichtag</strong> (Standard: Vortag des Spieltags, 20:00 Uhr). Bis dahin stellst du Waiver-Anträge${lineup ? ' und die Aufstellung' : ''} für diesen Spieltag;
          am Stichtag werden Waiver und Tausche ausgeführt${lineup ? ' und die Aufstellung wird fest' : ''}.</li>
        <li>Der <strong>Waiver-Zeitraum</strong> für einen Spieltag reicht vom Stichtag des vorigen Spieltags bis zu seinem eigenen Stichtag.</li>`}
        <li>Alle Wechsel gelten ab dem nächsten Spieltag – im laufenden Spieltag bleibt dein Kader${lineup ? ' samt Aufstellung' : ''} unverändert. Später gestellte Anträge gelten für den folgenden Spieltag.
          Fristen mit Countdown siehst du unter Team und Waiver, alle Zeiträume im Spielplan.</li>
        <li>Jeden Montag um 9 Uhr gibt es eine <strong>Wochen-Zusammenfassung</strong> per Push: deine Punkte der letzten 7 Tage, Tabellenplatz und bester Athlet.</li>
        <li>Ein Spieltag schließt nach seinem Ende und wird 7 Tage später eingefroren; bis dahin werden Korrekturen automatisch übernommen.</li>
        <li>Gleichstand in der Tabelle: zuerst mehr Spieltagssiege, dann höchster Einzelspieltag${draftCosts(l) ? ', dann weniger ausgegebenes Budget' : ''}.</li>
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Waiver und Tausch</h3></summary>
      <ul>
        <li>Freie Athleten holst du per <strong>Waiver-Antrag</strong>: freien Athleten wählen, eigenen Athleten abgeben (der Kader bleibt immer voll). Mehrere Anträge in Wunschreihenfolge sind möglich.</li>
        ${two && html`<li>In der <strong>freien Phase</strong> tauschst du sofort ohne Antrag – wer zuerst kommt, bekommt den Athleten.</li>`}
        <li>${l.waiver_mode === 'faab'
          ? html`<strong>FAAB:</strong> Du bietest verdeckt mit deinem Restbudget; das Höchstgebot gewinnt, bei Gleichstand der schlechter Platzierte.`
          : html`<strong>Priorität:</strong> Der Tabellenletzte wählt zuerst, dann der Vorletzte … Pro Runde bekommt jeder höchstens einen Athleten. Vor dem ersten Spieltag gilt die umgekehrte Draft-Reihenfolge.`}</li>
        <li>${two
          ? 'In der Waiver-Runde abgegebene Athleten sind erst in der freien Phase wieder zu haben; in der freien Phase abgegebene Athleten sind sofort frei.'
          : 'Abgegebene Athleten sind bis zum nächsten Stichtag gesperrt.'}</li>
        <li>Athleten mit Karriereende, Verletzungspause oder Sperre (vom Admin markiert) können sofort außer der Reihe ersetzt werden.</li>
        <li><strong>Tausch</strong> zwischen Managern: Beide müssen zustimmen, danach hat der Admin 24 Stunden Vetorecht. Ausgeführt wird zum nächsten Stichtag.</li>
        <li>Tausche dürfen ungleich sein (z. B. 1 gegen 2): Wer mehr Athleten bekommt, entlässt dafür eigene Athleten – beim Angebot bzw. bei der Annahme.
          Athleten aus offenen Waiver-Anträgen können dafür nicht gewählt werden. Wer weniger bekommt, hat danach einen freien Platz und füllt ihn per Waiver.</li>
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Daten</h3></summary>
      <ul>
        <li><strong>Quelle:</strong> World Athletics – deutsche Toplisten und die Ergebnislisten der Athleten.</li>
        <li><strong>Athletenpool:</strong> täglich um 6 Uhr aus den Toplisten.</li>
        <li><strong>Ergebnisse:</strong> täglich um 7 und 21 Uhr für alle Athleten im Pool und in den Kadern. Erscheinen, sobald World Athletics sie veröffentlicht –
          bei großen Meisterschaften meist am selben Tag, bei kleinen Wettkämpfen manchmal Tage später.</li>
        <li><strong>Jahre:</strong> „Punkte 2026“ zählt alle Wettkämpfe vom 1.1. bis 31.12.2026. Ergebnisse werden ab 2025 gespeichert.</li>
        <li><strong>Korrekturen:</strong> Bei falschen Daten kann der Admin Punkte manuell korrigieren – jede Korrektur wird protokolliert.</li>
      </ul>
    </details>
  </div>`;
}
