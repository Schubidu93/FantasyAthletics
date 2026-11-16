# Runner Fantasy – Hinweise für Claude

Überblick über Aufbau, Hosting, Abläufe und Secrets: siehe `README.md`. Grundlage ist UCI Fantasy
(github.com/Schubidu93/UCI-Fantasy); Verbesserungen dort lassen sich meist direkt übernehmen.

## Arbeitsregeln

- Sprache der App und der Antworten: Deutsch. Die Nutzer sind keine Entwickler – kurz, verständlich, ohne Fachjargon antworten.
- **Regeln mitziehen:** Bei jeder Änderung an Spielregeln, Wertung, Positionen, Draft, Waiver, Tausch, Spieltagen,
  Datenabruf (Zeiten, Quellen, Umfang) oder Liga-Einstellungen immer auch `web/views/rules.js`
  (Reiter „Regeln“) aktualisieren. Die Regeln sind dynamisch: Texte hängen von den Liga-Einstellungen
  (`gender`, `lineup_mode`, `wildcards`, `scoring_mode`, `transfer_mode`, `waiver_mode`, `draft_mode`) und von `scoring_config` ab.
- Der Draft-Report (Noten, „beste Aufstellung“) ist bewusst **nicht** in den Regeln beschrieben – Überraschung für die Mitspieler.
- Datenbankänderungen nur über `supabase/schema.sql`, und zwar **idempotent** (`create or replace`, `add column if not exists`,
  `drop function if exists` bei geänderter Signatur). Referenzdaten (Disziplinen, WA-Platzierungstabellen) nur über
  `research/build_placing_sql.py` → `supabase/reference_data.sql`. Nach dem Merge spielt „Datenbank einrichten“ beides ein.
- Spielregeln werden in der Datenbank erzwungen (security-definer-Funktionen), nicht in der App. Positionsregeln gibt es doppelt:
  `_slot_ok`/`league_slots` in der Datenbank und `slotOk`/`leagueSlots` in `web/lib.js` – immer beide ändern.
- `web/config.js` ist nur für lokale Tests und darf nicht eingecheckt werden. Keine Secrets in Code oder Chat.
- Mobile first: Die App wird fast nur auf dem iPhone (installiert als Web-App) genutzt. Nichts darf rechts
  abgeschnitten sein; lieber umbrechen oder kürzen. Fristen mit 0:00 Uhr als Vortag ohne Uhrzeit anzeigen (`fmtUntil` in `web/lib.js`).

## Plan des Nutzers

- Der Nutzer führt einen Plan als Dokument: „Runner Fantasy – mein Plan“
  (https://claude.ai/artifact/9zo7NFLFnNTV7QsQFuRgJC, Claude-Docs-Dokument).
- **Nach jeder Aktion und jeder Anfrage aktualisieren:** neue Aufgaben eintragen, Erledigtes abhaken bzw. in „Schon erledigt“
  verschieben, länger Erledigtes und nicht mehr Relevantes entfernen. Kurz halten.

## Ablauf einer Änderung

1. Auf einem Arbeitszweig ändern, lokal prüfen (siehe unten).
2. Pull Request auf `main` erstellen und mergen (Squash). Danach laufen automatisch:
   „App veröffentlichen“ (GitHub Pages, wenige Minuten) und bei SQL-Änderungen „Datenbank einrichten“.
3. Live-Daten prüfen: Workflow „Datenbank abfragen (nur lesen)“ (`db-query.yml`) mit einer SQL-Abfrage starten,
   Ergebnis steht im Job-Log. Für einen Überblick: „Datenstand prüfen“ (`db-status.yml`).
4. Dem Nutzer sagen, dass er die App neu laden soll (installierte App: ganz schließen und neu öffnen).

## Lokal testen

- `npm test`: Spiellogik gegen echtes PostgreSQL 16 (Schema wird zweimal eingespielt = Wiederholbarkeit), Punkte nach
  WA-Regeln, Positionen/Mixed, Draft; Parser- und Platzierungstests mit echten Daten der WM Tokio 2025 (`tests/fixtures/`).
  Lokal z. B. `initdb` + `pg_ctl` mit Socket in `/tmp/fa-pg`, Port 54329 (`TEST_DATABASE_URL` überschreibt).
- Syntax der App: `node --check web/views/<datei>.js`; TypeScript: `npm run lint`.
- Oberfläche: `tests/ui/seed.ts` (Testliga) + `tests/ui/mock-api.ts` (Supabase-Schnittstelle auf lokalem Postgres, RLS aktiv),
  `web/config.js` mit `http://localhost:54321`, `python3 -m http.server -d web`, Playwright in iPhone-Ansicht
  (Sitzung als `sb-localhost-auth-token` in localStorage). Die App scrollt innen (`.scroll`) – für ganze Seiten das Fenster hochstellen.
- Achtung: Die echte API liefert max. **1000 Zeilen** pro Abfrage – große Abfragen seitenweise (`all()` / `rpcAll()` in `web/lib.js`).
- Achtung: Bei Einbettungen (`leagues(...)`) den Fremdschlüssel nennen, sobald es mehrere Wege gibt
  (z. B. `leagues!managers_league_id_fkey(...)`).

## Daten

- Quelle nur **World Athletics**: DE-Toplisten (`importer/sync-pool.ts`) und die GraphQL-Schnittstelle der Website
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
- Rekorde: `importer/sync-records.ts` liest die All-time-Listen (alle Leistungen) DE/Europa/Welt, `recordMarks()` erkennt Rekorde ab 2025
  (auch inzwischen verbesserte) → `apply_records` setzt `wa_results.record` (DR/ER/WR, nur hochstufen) → Bonus aus `scoring_config.record_*`.
  Zwischenzeiten (`_is_split`: „… - Split times“ / ST) geben keine Punkte.
- Kalender: `importer/sync-calendar.ts` → `calendar_events` (WA-Kalender: weltweit ab GL, Europa ab A, Deutschland ab E;
  Programm aus `getCompetitionOrganiserInfo`, Filter in `importer/calendar-filter.ts`).
- Cross: Disziplin heißt nur „Cross Country“, die Distanz steht im Wettkampfnamen („… - XC 7.5km“) → `cross_km()` in der Datenbank,
  `crossKm()`/`discWithKm()` in `web/lib.js`; Distanzfaktor aus `cross_distance_factors`. Mehrere Rennen eines Wettkampfs
  (z. B. Pforzheim 1,5 und 7,5 km) haben dieselbe Wettkampf-ID und werden über die Distanz im Label getrennt.
- Q/q: im GraphQL-Feld `qualified` steht für Q und q `false`, für Ausgeschiedene `null` (geprüft an WM 2025, Hallen-WM 2026, EM 2026).
- worldathletics.org ist aus der Claude-Umgebung meist gesperrt; Rohdaten dann per Workflow „WA-Regeln und Beispieldaten laden“ holen.
- Namen: `athletes.id` = `wa-<WA-ID>` (Fremdschlüssel überall `athlete_id`), `competitions.id` = `wa-c<Wettkampf-ID>`
  (`results.competition_id`), Fantasy-Punkte `results.points`, Pool-Rang `athletes.pool_rank`. Bis November 2026 hießen sie
  wie bei UCI Fantasy `riders`/`pcs_slug`/`rider_slug`/`races`/`uci_*` – die Umbenennung steht oben in `schema.sql`.
  In App-Code heißen manche Variablen noch `rider…` (z. B. `RiderCell`, `riderMap`). Daten ab 2025.

## Feedback

- App: Mehr → Feedback (`web/views/feedback.js`), Bilder werden im Browser verkleinert (JPEG, max. 1600 px).
- Datenbank: `submit_feedback` → Tabellen `feedback`/`feedback_images`; startet sofort „Feedback senden“ (`feedback.yml`,
  `datasync/send_feedback.py`, SMTP-Secrets). Bilder werden nach dem Versand gelöscht.

## Offene Punkte (Stand November 2026)

- Einrichtung (Supabase-Projekt, Secrets, GitHub Pages) steht noch aus – siehe README „Einrichtung“.
- Der Importer ist mit echten Daten nur über die Erkundungs-Workflows geprüft; der erste echte Lauf sollte im Log kontrolliert werden.
- Ideen für später: 50-%-Regel (Athleten, die die meisten Punkte außerhalb der Laufdisziplinen holen, ausschließen – mit Ausnahmeliste),
  Startlisten, Verletzungen/Pausen markieren.
- LADV als Zusatzquelle: automatisches Auslesen laut Nutzungsbedingungen verboten, API-Keys derzeit nicht vergeben
  (siehe `research/fremdquellen-notizen.md`). Erst wieder angehen, wenn ein Key vorliegt.
