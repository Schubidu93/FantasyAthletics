// Spielregeln – allgemeine Regeln plus die Einstellungen der aktuellen Liga
import { html } from '../vendor/preact-htm.js';
import { draftCosts, fmtDate, q, sb, useLoad } from '../lib.js';
import { AREA_GROUPS, AREAS, discLabel, GENDER_LABEL, GROUP_LABEL, groupArea, leagueAreas, leagueSlots, positionGroups, slotLabel } from './lib.js';

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
  // Spieljahr: ab 1. November das Folgejahr (wie game_year() in der Datenbank)
  const gy = cfg?.game_year || new Date().getFullYear() + (new Date().getMonth() >= 10 ? 1 : 0);
  const two = l.transfer_mode === 'waiver_free';
  const lineup = l.scoring_mode === 'lineup';
  const slots = leagueSlots(l);
  const areas = leagueAreas(l);
  const runOnly = areas.length === 1 && areas[0] === 'Lauf';
  const areaText = runOnly ? 'nur Lauf (ab 800 m)' : areas.length === AREAS.length ? 'alle Disziplinen' : areas.join(', ');
  const extras = html`<li>Der Admin kann einen Draft-Termin festlegen – dann läuft für alle ein Countdown und der Draft startet automatisch.</li>
        ${l.draft_mode !== 'offline' && html`<li>Bist du an der Reihe${['live', 'blind'].includes(l.draft_mode) ? ' (Nominieren oder Auffüllen)' : ''}, bekommst du eine Push-Nachricht „Du bist dran“.</li>`}`;
  const row = (k, v) => html`<tr><td>${k}</td><td><strong>${v}</strong></td></tr>`;
  return html`<div class="stack rules">
    <section class="card">
      <h2>So funktioniert Athletics Fantasy</h2>
      <p>Jeder Manager stellt ein Team aus deutschen ${runOnly ? 'Läuferinnen und Läufern' : 'Leichtathletinnen und Leichtathleten'} zusammen. Für jedes Ergebnis seiner
        ${l.scoring_mode === 'lineup' ? 'aufgestellten ' : ''}Athleten gibt es Punkte – aus der Leistung (WA-Punkte) und der Platzierung.
        Wer am Saisonende die meisten Punkte hat, gewinnt die Liga.</p>
    </section>

    <section class="card">
      <h3>Einstellungen dieser Liga</h3>
      <table class="tbl"><tbody>
        ${row('Wertung', GENDER_LABEL[l.gender])}
        ${row('Disziplinen', areaText)}
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
        <li><strong>Wer ist dabei?</strong> Deutsche Athletinnen und Athleten mit mindestens ${cfg ? cfg.pool_threshold : 975} WA-Punkten
          in der deutschen Topliste dieses oder des letzten Jahres. Wer laut World Athletics für ein anderes Land startet, fällt heraus.</li>
        <li><strong>Diese Liga:</strong> ${areaText}${l.gender !== 'mixed' ? `, nur ${GENDER_LABEL[l.gender]}` : ''}. Es gibt nur Athleten,
          deren Schwerpunkt-Disziplin dazu gehört – von ihnen zählen aber alle Ergebnisse${runOnly ? ' (z. B. auch die 400 m eines 800-m-Läufers)' : ''}.</li>
        <li><strong>Aktualisierung:</strong> täglich; neue Athleten sind automatisch frei.</li>
      </ul>
      <h4 class="rule-sub">Schwerpunkt-Disziplinen</h4>
      <table class="tbl rule-tbl"><tbody>
        ${AREAS.filter((a) => areas.includes(a)).map((a) => html`<tr key=${a}><td>${a}</td><td>${AREA_GROUPS[a].map((g) => GROUP_LABEL[g]).join(' · ')}</td></tr>`)}
      </tbody></table>
      <ul>
        <li>Es zählt die Disziplin mit den meisten Punkten im Vorjahr (Saison ${gy} → Punkte ${gy - 1}); sie gilt die ganze Saison.
          Verwandte Strecken zählen mit, z. B. Meile → 1500 m, 3000 m → 5000 m, Halbmarathon → Marathon, 60 m → 100 m.</li>
        ${areas.includes('Lauf') && html`<li>Cross nach Länge: bis 3 km 1500 m, bis 6 km 5000 m, bis 12 km 10.000 m, darüber Marathon.</li>`}
        <li>Ohne Punkte im Vorjahr zählt die beste Leistung; ganz neue Athleten kommen in die Disziplin ihrer ersten Leistung
          ab ${cfg?.new_group_threshold ?? 975} WA-Punkten.</li>
        <li><strong>Pool-Rang</strong> (Reihenfolge im Draft): nach den Punkten im Vorjahr der Saison, bei Gleichstand nach der besten Toplistenleistung.</li>
        ${lineup ? html`
          <li>Für jeden Spieltag stellst du bis zu ${slots.length} Athleten auf: ${l.lineup_mode === 'mf'
            ? 'je Disziplin einen Mann und eine Frau' : 'je Disziplin einen Athleten dieser Gruppe'}${l.wildcards > 0
            ? `, dazu ${l.wildcards} Wildcard${l.wildcards > 1 ? 's' : ''} mit Athleten jeder Disziplin der Liga` : ''}.
            ${blockText(l.lineup_groups || [])}
            ${areas.includes('Gehen') && !(l.lineup_groups || []).includes('Gehen') ? 'Geher können nur auf eine Wildcard.' : ''}</li>
          <li>Positionen ohne passenden Athleten bleiben leer. Bis zum Stichtag änderbar, danach ist die Aufstellung für diesen Spieltag fest.
            Stellst du nicht neu auf, gilt die Aufstellung vom vorigen Spieltag (beim ersten Spieltag: automatisch deine teuersten bzw. besten passenden Athleten).</li>
          <li>Wird ein Athlet per Waiver ersetzt, rückt der neue auf seine Position nach, wenn er dort passt – sonst bleibt sie leer.</li>`
        : html`<li>Es zählen <strong>alle Athleten deines Kaders</strong>.</li>`}
      </ul>
    </details>

    <details class="card rule-sec">
      <summary><h3>Punkte</h3></summary>
      <div class="rule-formula">
        <div><strong>Punkte = (Leistung + Platzierung) × Disziplinfaktor</strong></div>
        <div>Leistung = (WA-Punkte − ${cfg ? cfg.perf_threshold : 1000}) × ${cfg ? fmtNum(cfg.perf_factor) : '0,1'} <span class="muted">(nur darüber)</span></div>
        <div>Platzierung = WA-Platzierungspunkte × ${cfg ? fmtNum(cfg.placing_factor) : '0,2'}</div>
        <div>dazu Bonus für Bestleistung und Rekord <span class="muted">(siehe unten)</span></div>
      </div>
      ${cfg && cfg.perf_threshold === 1000 && html`<p class="muted small">Beispiel: Marathon in 2:09:43 (1135 WA-Punkte), Platz 9 ohne Platzierungspunkte:
        135 × ${fmtNum(cfg.perf_factor)} × 3 = <strong>${fmtNum(Math.round(135 * cfg.perf_factor * 3 * 100) / 100)} Punkte</strong>.</p>`}
      <h4 class="rule-sub">Disziplinfaktoren</h4>
      <p class="muted small">Lange Wettkämpfe zählen mehr, weil es davon nur wenige im Jahr gibt. Alle anderen Disziplinen: × 1.
        Staffeln: Leistung und Platzierung wie über die Einzelstrecke, davon ¼ (4er-Staffel) bzw. ⅓ (3er-Staffel).</p>
      <table class="tbl rule-tbl"><tbody>
        ${factorRows(disciplines, areas).map(([f, names]) => html`<tr key=${f}><td class="num">× ${fmtNum(f)}</td><td>${names.join(' · ')}</td></tr>`)}
      </tbody></table>
      <ul>
      </ul>
      <h4 class="rule-sub">Platzierung</h4>
      <ul>
        <li>Nach den World-Ranking-Regeln 2026 von World Athletics – je nach Kategorie und Platz. Kategorien: OW = Olympia/WM ·
          DF = Diamond-League-Finale · GW = Hallen-WM/Diamond League · GL = EM · danach A bis F.</li>
        <li><strong>Vorläufe und Halbfinals</strong> zählen nur bei OW, DF, GW und GL – und nur die letzte Runde vor dem Finale.</li>
        <li><strong>Finals mit mehreren Läufen:</strong> Platz über alle Läufe, gewertet wie ein Finale.</li>
        <li><strong>Meisterschaft im offenen Rennen</strong> (z. B. DM im Hannover-Marathon): Es zählt der bessere Wert aus Platz im Rennen
          und Meisterschaftsplatz. Meistertitel tragen einen 🏆.</li>
      </ul>
      <h4 class="rule-sub">Bonus</h4>
      <table class="tbl rule-tbl"><tbody>
        <tr><td class="num">+ ${cfg?.pb_points ?? 10}</td><td>Persönliche Bestleistung (gleiche Leistung „=PB“: halb)</td></tr>
        <tr><td class="num">+ ${cfg?.record_dr ?? 50}</td><td>Deutscher Rekord</td></tr>
        <tr><td class="num">+ ${cfg?.record_er ?? 100}</td><td>Europarekord</td></tr>
        <tr><td class="num">+ ${cfg?.record_wr ?? 200}</td><td>Weltrekord (eingestellter Rekord: halb; es zählt nur der höchste)</td></tr>
      </tbody></table>
      <ul>
        <li>Bestleistung = besser als alle früheren Leistungen in dieser Disziplin (laut World Athletics, auch vor 2025) – im Sprung, Wurf
          und Mehrkampf weiter, höher bzw. mehr Punkte. Halle, Bahn und Straße getrennt; nur ab ${cfg ? cfg.perf_threshold : 1000} WA-Punkten,
          nicht beim ersten Start in einer Disziplin und nicht in Staffeln.</li>
        <li>Rekorde erkennt die App täglich an den All-time-Listen von World Athletics – auch solche, die inzwischen verbessert wurden.</li>
      </ul>
      <h4 class="rule-sub">Gut zu wissen</h4>
      <ul>
        <li><strong>Ein Wettkampf = ein Ergebnis:</strong> Läuft ein Athlet bei einem Wettkampf mehrere Runden (z. B. Vorlauf und Finale),
          gibt es Leistungs- und Platzierungspunkte nur für die beste. Bestleistungs- und Rekord-Bonus zählen in jeder Runde.</li>
        ${areas.includes('Mehrkampf') && html`<li><strong>Mehrkampf:</strong> Es zählt das Gesamtergebnis. Die einzelnen Disziplinen darin bringen
          nur den Bestleistungs- und Rekord-Bonus.</li>`}
        ${areas.includes('Lauf') && html`<li><strong>Cross:</strong> fester Wert je Platz und Kategorie (z. B. GL-Sieg 1200) statt WA-Punkten, gewertet wie eine
          Leistung × ${cfg ? fmtNum(cfg.cross_factor) : '0,1'} × Distanzfaktor (bis 3 km 1 · bis 6 km 1,3 · bis 12 km 1,6 · darüber 2).</li>`}
        <li><strong>Zwischenzeiten</strong> (z. B. 1500 m im Meilenrennen) bringen nur Bestleistungs- und Rekord-Bonus.</li>
        <li>Punkte zählen nur in Spieltagen, in denen der Athlet in deinem Kader steht${lineup ? ' und aufgestellt ist' : ''}.</li>
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
        <li>Holt einer deiner Athleten Punkte, die für einen Spieltag zählen${lineup ? ' (also wenn er aufgestellt ist)' : ''}, bekommst du kurz nach dem Ergebnisabruf eine Push-Nachricht <strong>„Neue Punkte“</strong>.</li>
        <li>Außerdem gibt es Push-Nachrichten zu Waiver-Ergebnissen, neuen Tauschangeboten, Zusage oder Absage, zurückgezogenen Angeboten,
          ausgeführten oder geplatzten Tauschen und einem Veto des Admins.</li>
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
        <li><strong>Athleten hinzufügen:</strong> Der Admin kann einzelne Athleten per WA-ID oder Namen hinzufügen (z. B. unter der Pool-Grenze);
          sie sind danach dauerhaft im Pool, ihre Ergebnisse und Bestleistungen werden wie bei allen anderen geladen.</li>
        <li><strong>Bestleistungen:</strong> täglich nach dem Athletenpool je Athlet von World Athletics (für Profil und PB-Bonus).</li>
        <li><strong>Rekorde:</strong> täglich nach dem Athletenpool aus den All-time-Listen von World Athletics für Deutschland, Europa und die Welt.</li>
        <li><strong>Kalender:</strong> täglich um 6 Uhr die kommenden Wettkämpfe aus dem Kalender von World Athletics –
          international ab Gold Label, in Europa ab Kategorie A, in Deutschland ab Kategorie E. Angezeigt werden Wettkämpfe mit Disziplinen
          dieser Liga (laut Programm, sonst laut Name).</li>
        <li><strong>Ergebnisse:</strong> stündlich von 8 bis 23 Uhr für alle Athleten im Pool und in den Kadern. Erscheinen, sobald World Athletics sie veröffentlicht –
          bei großen Meisterschaften meist am selben Tag, bei kleinen Wettkämpfen manchmal Tage später. Werden die Ergebnisse eines Wettkampfs nach und nach
          hochgeladen (z. B. erst 800 m, Stunden später 5000 m), kommen sie auch nach und nach in die Wertung.</li>
        <li><strong>Kontrolle:</strong> Jede Nacht werden alle Athleten in den Kadern komplett neu abgeglichen, die übrigen einmal pro Woche –
          nachträgliche Korrekturen von World Athletics (andere Zeit, gestrichenes Ergebnis) werden so übernommen.</li>
        <li><strong>Jahre:</strong> „Punkte 2026“ zählt alle Wettkämpfe vom 1.1. bis 31.12.2026. Ergebnisse werden ab 2025 gespeichert.</li>
        <li><strong>Nachträge:</strong> Rennen auf vermessenen Strecken, die World Athletics nicht führt (z. B. Ergebnisse bei RaceResult),
          kann der Admin von Hand nachtragen – mit Bruttozeit, Land, Wettkampfkategorie (Standard F) und Link zur Quelle. Die WA-Punkte berechnet
          die App nach den Punktetabellen von World Athletics; mit Platz gibt es Platzierungspunkte nach der Kategorie. Taucht das Ergebnis später
          bei World Athletics auf, gilt das WA-Ergebnis.</li>
        <li><strong>Staffeln</strong> (3 × 800 m, 3 × 1000 m, 4 × 400 m, nur als Nachtrag): Die Endzeit wird durch die Zahl der Läufer geteilt
          und wie ein Einzelrennen über die Teilstrecke gewertet (z. B. 3 × 800 m in 6:08,33 → 2:02,78 über 800 m). Jeder Läufer bekommt
          davon ein Drittel bzw. Viertel – für Leistung und Platzierung.</li>
        <li><strong>Korrekturen:</strong> Bei falschen Daten kann der Admin Punkte manuell korrigieren – jede Korrektur wird protokolliert.</li>
      </ul>
    </details>
  </div>`;
}
