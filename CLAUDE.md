# Runner Fantasy – Hinweise für Claude

Überblick über Aufbau, Hosting, Abläufe und Secrets: siehe `README.md`. Grundlage ist UCI Fantasy
(github.com/Schubidu93/UCI-Fantasy); Verbesserungen dort lassen sich meist direkt übernehmen.

## Arbeitsregeln

- Sprache der App und der Antworten: Deutsch. Die Nutzer sind keine Entwickler – kurz, verständlich, ohne Fachjargon antworten.
- **Architektur:** stabil, nachhaltig, gut gegliedert, nach aktuellem Stand – nicht nur „läuft“. Jede Regel an genau einer Stelle,
  keine doppelte Logik, Änderungen mit Tests absichern, beide Apps gleich aufgebaut (ausdrücklicher Wunsch des Nutzers).
- **Beide Apps mitdenken:** Bei jeder Änderung prüfen, ob sie auch für UCI Fantasy (github.com/Schubidu93/UCI-Fantasy) sinnvoll ist,
  und dem Nutzer dann kurz vorschlagen, sie dort zu übernehmen (ausdrücklicher Wunsch des Nutzers).
- Wünsche kritisch prüfen: Ist eine Anforderung unsinnig, widersprüchlich oder schadet sie der App, das offen sagen und nicht
  umsetzen, sondern kurz begründen und eine bessere Lösung vorschlagen (ausdrücklicher Wunsch des Nutzers).
- **Regeln mitziehen:** Bei jeder Änderung an Spielregeln, Wertung, Positionen, Draft, Waiver, Tausch, Spieltagen,
  Datenabruf (Zeiten, Quellen, Umfang) oder Liga-Einstellungen immer auch `web/sport/rules.js`
  (Reiter „Regeln“) aktualisieren. Die Regeln sind dynamisch: Texte hängen von den Liga-Einstellungen
  (`gender`, `lineup_mode`, `wildcards`, `scoring_mode`, `transfer_mode`, `waiver_mode`, `draft_mode`) und von `scoring_config` ab.
- Der Draft-Report (Noten, „beste Aufstellung“) ist bewusst **nicht** in den Regeln beschrieben – Überraschung für die Mitspieler.
- Datenbankänderungen nur über `supabase/schema/NN_*.sql` (nach Themen, Einspielen in Dateireihenfolge), und zwar **idempotent** (`create or replace`, `add column if not exists`,
  `drop function if exists` bei geänderter Signatur). Referenzdaten (Disziplinen, WA-Platzierungstabellen) nur über
  `research/build_placing_sql.py` → `supabase/reference_data.sql`. Nach dem Merge spielt „Datenbank einrichten“ beides ein.
- Spielregeln werden in der Datenbank erzwungen (security-definer-Funktionen), nicht in der App. Positionsregeln gibt es doppelt:
  `_slot_ok`/`league_slots`/`_position_groups`/`_group_area`/`_eligible` in der Datenbank und `slotOk`/`leagueSlots`/`positionGroups`/`groupArea`/`eligible`
  in `web/sport/lib.js` – immer beide ändern. Bereiche je Liga: `leagues.areas` (Lauf, Sprint, Hürden, Sprung, Wurf, Mehrkampf, Gehen);
  es gibt nur Athleten mit Schwerpunkt-Disziplin darin (`_eligible`; in der App blendet `loadPeople` die übrigen aus, außer sie standen
  in der Liga je im Kader); von ihnen zählen alle Ergebnisse, auch in anderen Bereichen. Gruppen (Schwerpunkt-Disziplin,
  `disciplines.event_group`): Lauf 800…Hindernis, Sprint 100/200/400, Hürden Kurz-/Langhürden, Sprung 4, Wurf 4, Mehrkampf, Gehen.
  Blöcke als Positionen: „Mittel“, „Lang“, „Sprint“, „Hürden“, „Sprung“, „Wurf“. Spiele (Voreinstellungen `AREA_PRESETS` in
  `web/sport/lib.js`): nur Lauf, Sprint und Hürden, nur Sprung, nur Wurf (kleine Ligen empfohlen), alle (Blöcke) oder eigene Auswahl. Sprung/Wurf/Mehrkampf: mehr ist besser (`disciplines.higher_better`,
  `_mark_cost` in der Datenbank, `markCost`/`higherBetter` in `importer/disciplines.ts`; Test prüft Gleichstand mit `research/disciplines.txt`).
- `web/config.js` ist nur für lokale Tests und darf nicht eingecheckt werden. Keine Secrets in Code oder Chat.
- Mobile first: Die App wird fast nur auf dem iPhone (installiert als Web-App) genutzt. Nichts darf rechts
  abgeschnitten sein; lieber umbrechen oder kürzen. Fristen mit 0:00 Uhr als Vortag ohne Uhrzeit anzeigen (`fmtUntil` in `web/lib.js`).

## Plan des Nutzers

- Der Nutzer führt einen Plan als Dokument: „Runner Fantasy – mein Plan“
  (https://claude.ai/artifact/9zo7NFLFnNTV7QsQFuRgJC, Claude-Docs-Dokument).
- **Nach jeder Aktion und jeder Anfrage aktualisieren:** neue Aufgaben eintragen, Erledigtes abhaken bzw. in „Schon erledigt“
  verschieben, länger Erledigtes und nicht mehr Relevantes entfernen. Kurz halten.

## Aufbau der App (in beiden Apps gleich)

- `web/app.js`, `web/views/*.js`, `web/views/admin/*.js`: **in Runner Fantasy und UCI Fantasy wortgleich**. Änderungen dort immer in
  beiden Apps vornehmen (Datei kopieren). Alles, worin sich die Sportarten unterscheiden, steht in `web/sport/`:
  - `sport/index.js`: `SPORT` (Begriffe Athlet/Fahrer in allen Fällen, Texte; Datenbank-Namen sind in beiden Apps gleich), `pid()`, `rank()`,
    `selectable()`, `usePeopleFilter()`, `PersonLine`, `labelText()`
  - `sport/views.js` (Navigation, eigene Seiten, Laden der Personen), `sport/settings.js` (Liga-Einstellungen), `sport/lineup.js`
    (Aufstellung), `sport/matchdays.js` (Spieltag-Vorschläge), `sport/admin.js` (Zusatzbereiche im Admin) und die Sportart-Seiten
    (Personenliste, Wettkämpfe/Rennen, Profil, ggf. Kalender/Toplisten).
- Datenbank: `supabase/schema/NN_*.sql` mit gleichen Nummern und Namen in beiden Apps. Sportart-Schicht `02_sportart.sql`:
  `_word()` (Begriffe in Meldungen wie `SPORT`), `_fmt_pts()`, `_pts_digits()`, `_eligible(liga, athlet)` (darf geholt werden), `_app()` (Repository, Kurzname),
  `_sport_tick()` (Datenabruf-Zeiten), ggf. Positionen/Gruppen. Wortgleich in beiden Apps: 03, 05–08, 12–14, 16, 17 und alle `tests/sql/*` außer `06_deadlines`/`fixtures` (Liste in `scripts/shared.mjs`) – Meldungen dort nur
  mit `_word('one'|'oneAcc'|'many'|'manyDat'|'team'|'teamGen'|…)`, nie „Athlet“/„Fahrer“ fest.
- Gemeinsame Dateien sind in `scripts/shared.mjs` aufgezählt, ihre Prüfsummen stehen in `shared-files.json` (in beiden Apps gleich).
  `tests/shared.test.ts` scheitert, wenn eine davon nur in einer App geändert wurde: Änderung in die andere App kopieren und in beiden
  `node scripts/shared.mjs update` ausführen. `web/lib.js` und `web/style.css` sind gemeinsam; Leichtathletik-Helfer stehen in `web/sport/lib.js`, Farben und
  sportartspezifische Gestaltung in `web/sport/style.css`.
  Gemeinsam sind auch `datasync/db.py`, `send_push.py`, `send_feedback.py` (App-Name aus `datasync/app_info.py`), `web/vendor/`,
  `tsconfig.json` und der Testablauf `ci.yml`; ihre Tests stehen in `tests/datasync/test_common.py`.
- Tests: `tests/sql/NN_*.sql` (Spiellogik, in beiden Apps gleich), `tests/*.test.ts` (u. a. `workflows.test.ts`: jeder von der
  Datenbank gestartete Ablauf existiert), Oberflächentest `tests/ui/smoke.test.ts`
  (öffnet alle Seiten in der iPhone-Ansicht und scheitert bei jedem Fehler; beide Apps gleich).

## Ablauf einer Änderung

Schritt für Schritt: Skill `aenderung` (`.claude/skills/aenderung/SKILL.md`, in beiden Apps gleich). Beim Start einer Cloud-Sitzung
richtet `.claude/hooks/session-start.sh` Pakete und das Test-PostgreSQL ein.

1. Auf einem Arbeitszweig ändern, lokal prüfen (siehe unten).
2. Pull Request auf `main` erstellen und mergen (Squash). Danach laufen automatisch:
   „App veröffentlichen“ (GitHub Pages, wenige Minuten) und bei SQL-Änderungen „Datenbank einrichten“.
3. Live-Daten prüfen: täglich automatisch „Gesundheitscheck“ (`health.yml`, `_health_check()` in `17_zeitplaner.sql`; schlägt bei
   Problemen fehl, GitHub mailt) – nach einer Änderung von Hand starten. Gezielt: „Datenbank abfragen (nur lesen)“ (`db-query.yml`) mit einer SQL-Abfrage starten,
   Ergebnis steht im Job-Log. Für einen Überblick: „Datenstand prüfen“ (`db-status.yml`).
4. Dem Nutzer sagen, dass er die App neu laden soll (installierte App: ganz schließen und neu öffnen).

## Lokal testen

- `npm test`: Spiellogik gegen echtes PostgreSQL 16 und Oberflächentest (Playwright, Chromium) (Schema wird zweimal eingespielt = Wiederholbarkeit), Punkte nach
  WA-Regeln, Positionen/Mixed, Draft; Parser- und Platzierungstests mit echten Daten der WM Tokio 2025 (`tests/fixtures/`).
  Lokal z. B. `initdb` + `pg_ctl` mit Socket in `/tmp/fa-pg`, Port 54329 (`TEST_DATABASE_URL` überschreibt).
  SQL-Tests in `tests/sql/NN_*.sql` (pgTAP-Schreibweise `is`/`ok`/`throws_ok`, kleiner Ersatz in `tests/sql/_tap.sql`, Beispieldaten
  `tests/sql/fixtures.sql`): Kader, Draft, Waiver, Tausch, Wertung/Einfrieren, Fristen, Berechtigungen – in beiden Apps gleich gehalten.
- Syntax der App: `node --check web/views/<datei>.js`; TypeScript: `npm run lint`.
- Python-Skripte (Push, Feedback): `tests/datasync/test_*.py` (unittest, ohne Netz, `FakeDb` statt `db.py`), laufen in `npm test` mit.
- Oberfläche: `tests/ui/seed.ts` (Testliga) + `tests/ui/mock-api.ts` (Supabase-Schnittstelle auf lokalem Postgres, RLS aktiv),
  `web/config.js` mit `http://localhost:54321`, `python3 -m http.server -d web`, Playwright in iPhone-Ansicht
  (Sitzung als `sb-localhost-auth-token` in localStorage). Die App scrollt innen (`.scroll`) – für ganze Seiten das Fenster hochstellen.
- Achtung: Die echte API liefert max. **1000 Zeilen** pro Abfrage – große Abfragen seitenweise (`all()` / `rpcAll()` in `web/lib.js`).
- Achtung: Bei Einbettungen (`leagues(...)`) den Fremdschlüssel nennen, sobald es mehrere Wege gibt
  (z. B. `leagues!managers_league_id_fkey(...)`).

## Daten

- Quelle nur **World Athletics**: DE-Toplisten aller Disziplinen (`importer/sync-pool.ts`, Liste in `importer/disciplines.ts`) und die GraphQL-Schnittstelle der Website
  (`importer/sync-results.ts`, `importer/placings.ts`). Ehrliche Kennung, Pausen zwischen Abfragen, keine Umgehung von Bot-Schutz.
  Den API-Schlüssel liest der Importer bei Bedarf selbst von worldathletics.org.
- Ergebnisabruf sparsam: `resultsByAthlete` (Sammelabruf, letzte ~30 Tage, keine WA-Punkte/Wettkampf-ID) nur als Signal;
  Einzelabruf (`getSingleCompetitorResultsDate`, ganzes Jahr mit WA-Punkten) nur für Athleten mit Neuem bzw. nachts zur Kontrolle.
  Ende-zu-Ende-Test: `tests/importer.test.ts` (Nachbau von WA und Supabase-Schnittstelle).
- Nachträge: `wa_results.source = 'manual'` (+ `source_url`), angelegt über `add_manual_result`; der Importer löscht/überschreibt
  nur `source = 'wa'`. WA-Punkte aus `scoring_coefficients` (Parabel je Disziplin/Geschlecht, nachts neu berechnet).
  RaceResult/LADV nicht automatisch abrufen (siehe `research/fremdquellen-notizen.md`).
- Rohdaten in `wa_results`; `rebuild_results()` berechnet daraus die Punkte in `results` (die Spiellogik von UCI Fantasy liest nur `results`).
  Pool: `toplist_entries` → `refresh_pool()` setzt Bestleistung, `athletes.pool_rank` und `event_group`. Gruppe und Pool-Rang
  nach den Fantasy-Punkten im Vorjahr des Spieljahrs (`game_year()`: ab 1.11. das Folgejahr; Cross nach Länge über `_result_group`),
  ohne Punkte beste Leistung, neue Athleten erste Leistung ab `new_group_threshold` (975) im Spieljahr, sonst Toplisten.
- Bestleistungen: `importer/sync-pbs.ts` (getSingleCompetitor: personalBests, progressionOfSeasonsBests) → `athlete_pbs` (Profil)
  und `athlete_pb_before` (beste Leistung vor 2025). PB-Bonus `scoring_config.pb_points` über `_pb_factor()` in `rebuild_results`
  (schneller als alles davor = 1, gleich = 0,5 „=PB“; eingestellte Rekorde `=DR/=ER/=WR` halb; ab Schwelle, auch Zwischenzeiten, keine Staffeln; Halle = „… Short Track“).
- Rekorde: `importer/sync-records.ts` liest die All-time-Listen (alle Leistungen) DE/Europa/Welt, `recordMarks()` erkennt Rekorde ab 2025
  (auch inzwischen verbesserte) → `apply_records` setzt `wa_results.record` (DR/ER/WR, nur hochstufen) → Bonus aus `scoring_config.record_*`.
  Meisterschaft im offenen Rennen: Event-Ergebnisse haben mehrere `eventTitles` (offenes Rennen ohne Titel, z. B. Kategorie E, und
  „German Marathon Ch.“, Kategorie B); `championshipPlacing()` → `wa_results.champ_place/champ_category` (separates Update, Admin per
  `set_result_champ`), `category` = Hauptwertung. Platzierung = höherer Wert. GraphQL-Feld heißt `races` (früher `competitions`).
  Zwischenzeiten (`_is_split`: „… - Split times“ / ST) geben nur Rekord- und PB-Bonus. „Datenbank einrichten“ rechnet danach alle Punkte neu.
- Athlet hinzufügen (Admin → Athleten): `request_athlete` → `athlete_requests` → Ablauf `add-athlete.yml` (`importer/add-athlete.ts`:
  WA-ID/Profil-Link/Name via `searchCompetitors`, Stammdaten `getSingleCompetitor.basicData`; Geschlecht aus `sexCode` bzw. dem
  Suchtreffer mit gleicher ID, nicht von Hand; bei jedem Lauf werden alle `manual`-Athleten abgeglichen und ggf. korrigiert) → `athletes.manual = true` (immer im Pool,
  `ranking_points` aus bester WA-Leistung), dann Ergebnisse/Bestleistungen nur für diese Athleten (`ATHLETE_IDS`).
- Kalender: `importer/sync-calendar.ts` → `calendar_events` (WA-Kalender: weltweit ab GL, Europa ab A, Deutschland ab E;
  Programm aus `getCompetitionOrganiserInfo`, Bereiche je Wettkampf in `calendar_events.areas` aus `importer/calendar-filter.ts`).
  Kalender-Seite und Spieltag-Vorschläge (`web/sport/matchday-plan.js`, Tests `tests/matchdays.test.ts`) richten sich nach den
  Bereichen der Liga: Fachmeisterschaften (Cross/Straße, Winterwurf, Mehrkampf) nur in Ligen, die nur diesen Bereich spielen;
  ohne Lauf ab Oktober „Saisonpause“.
  Fehlen DM/Hallen-DM eines Jahres bei WA, nicht raten: einmalig in der DLV-Terminliste (leichtathletik.de) nachschlagen und in
  `extra_calendar_events` (`supabase/schema/01_tabellen.sql`, mit `source_url`) eintragen; der Spieltag-Vorschlag nimmt sie, solange WA keinen Termin hat.
- Cross: Disziplin heißt nur „Cross Country“, die Distanz steht im Wettkampfnamen („… - XC 7.5km“) → `cross_km()` in der Datenbank,
  `crossKm()`/`discWithKm()` in `web/lib.js`; Distanzfaktor aus `cross_distance_factors`. Mehrere Rennen eines Wettkampfs
  (z. B. Pforzheim 1,5 und 7,5 km) haben dieselbe Wettkampf-ID und werden über die Distanz im Label getrennt.
- Q/q: im GraphQL-Feld `qualified` steht für Q und q `false`, für Ausgeschiedene `null` (geprüft an WM 2025, Hallen-WM 2026, EM 2026).
- worldathletics.org ist aus der Claude-Umgebung meist gesperrt; Rohdaten dann per Workflow „WA-Regeln und Beispieldaten laden“ holen.
- Namen: `athletes.id` = `wa-<WA-ID>` (Fremdschlüssel überall `athlete_id`), `competitions.id` = `wa-c<Wettkampf-ID>`
  (`results.competition_id`), Fantasy-Punkte `results.points`, Pool-Rang `athletes.pool_rank` – seit November 2026 in beiden Apps
  dieselben Namen (vorher `riders`/`pcs_slug`/`rider_slug`/`races`/`uci_*`; die Umbenennung steht oben in `supabase/schema/01_tabellen.sql`).
  In App-Code heißen manche Variablen noch `rider…` (z. B. `RiderCell`, `riderMap`). Daten ab 2025.

## Push „Neue Punkte“ und heiße freie Athleten

- `notify_new_points()` (aus `run_maintenance` nach jedem Ergebnisabruf): neue Zeilen aus `_score_rows` (zählen für einen Spieltag,
  bei Aufstellung nur Aufgestellte, höchstens 14 Tage alt) → eine Nachricht je Manager; gemeldet wird je Manager/Athlet/Wettkampf/Lauf
  einmal (`point_pushes`). Beim Einführen wurden alle bisherigen Punkte als gemeldet eingetragen.
- Athleten → „🔥 Heiße freie Athleten“: `athlete_points_recent(p_gender, p_days)`; 🔥 = die 10 freien mit den meisten Punkten der letzten 30 Tage.

## Feedback

- App: Mehr → Feedback (`web/views/feedback.js`), Bilder werden im Browser verkleinert (JPEG, max. 1600 px).
- Datenbank: `submit_feedback` → Tabellen `feedback`/`feedback_images`; startet sofort „Feedback senden“ (`feedback.yml`,
  `datasync/send_feedback.py`, SMTP-Secrets). Bilder werden nach dem Versand gelöscht.

## Offene Punkte (Stand November 2026)

- Einrichtung (Supabase-Projekt, Secrets, GitHub Pages) steht noch aus – siehe README „Einrichtung“.
- Der Importer ist mit echten Daten nur über die Erkundungs-Workflows geprüft; der erste echte Lauf sollte im Log kontrolliert werden.
- Ideen für später: Startlisten, Verletzungen/Pausen markieren.
- LADV als Zusatzquelle: automatisches Auslesen laut Nutzungsbedingungen verboten, API-Keys derzeit nicht vergeben
  (siehe `research/fremdquellen-notizen.md`). Erst wieder angehen, wenn ein Key vorliegt.
