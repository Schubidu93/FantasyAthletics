# Runner Fantasy

Fantasy-Leichtathletik mit deutschen Läuferinnen und Läufern: Draft (Snake, Live-Auktion, Blind-Auktion oder offline),
Waiver und freie Transferphase, Tausch, frei setzbare Spieltage, Aufstellung mit festen Positionen je Disziplin und Liga-Tabelle.
Gewertet werden die Ergebnisse von **World Athletics**: Leistungspunkte (WA-Punkte über einer Schwelle) plus
Platzierungspunkte genau nach den World-Ranking-Regeln 2026.

Grundlage ist [UCI Fantasy](https://github.com/Schubidu93/UCI-Fantasy) – Aufbau, Spiellogik und Abläufe sind übernommen,
Datenquelle, Wertung und Aufstellung sind auf Leichtathletik umgebaut.

**App:** https://schubidu93.github.io/FantasyAthletics/ (installierbar als Web-App auf dem Handy)

## Wo läuft was?

| Teil | Ort |
|---|---|
| App (statische Web-App, Preact) | **GitHub Pages** – veröffentlicht von *App veröffentlichen* |
| Datenbank, Login, Spiellogik, Zeitplaner | **Supabase** (Postgres, Auth, Realtime, pg_cron) |
| Datenabruf und Push-Nachrichten | **GitHub Actions** – gestartet vom Zeitplaner in der Datenbank |

## Aufbau

| Ordner | Inhalt |
|---|---|
| `web/` | Die App: `app.js` (Rahmen, Navigation), `lib.js` (Helfer, Disziplinen, Positionen), `views/` (Bereiche), `sw.js` (Push) |
| `supabase/schema.sql` | Datenbank komplett und idempotent: Tabellen, Rechte und die gesamte Spiellogik (Draft, Waiver, freie Phase, Tausch, Aufstellung, Wertung, Zeitplaner) |
| `supabase/reference_data.sql` | Disziplinen (Faktor, Gruppe) und WA-Platzierungstabellen 2026 – erzeugt von `research/build_placing_sql.py` |
| `importer/` | Datenabruf von World Athletics (TypeScript): Athletenpool aus den DE-Toplisten, Ergebnisse inkl. Q/q und kombinierter Finals |
| `datasync/` | Python-Skripte für Push-Versand und Feedback-Mails |
| `tests/` | Tests der Spiellogik gegen echtes PostgreSQL, Parser-Tests mit echten WM-Daten, Oberflächentest-Werkzeuge (`tests/ui/`) |
| `research/` | Gesicherte WA-Regeltexte und das Skript, das daraus die Platzierungstabellen erzeugt |

Die Spielregeln werden in der Datenbank geprüft (Positionen, Uhr, Kadergröße, Fristen, Waiver-Reihenfolge …), nicht in der App.

## Spielregeln in Kürze

- **Wertung:** Männer, Frauen oder Mixed. Bei Mixed: Positionen beliebig besetzen oder je Disziplin ein Mann und eine Frau.
- **Athletenpool:** DE-Toplisten (Senioren) des aktuellen Jahres und des Vorjahres, Laufdisziplinen ab 800 m inkl. Halle, Hindernis und Straße, ab 1000 WA-Punkten.
- **Aufstellung:** Positionen 800, 1500, 5000, 10.000, Marathon, Hindernis (wählbar) plus Wildcards. Die Gruppe eines Athleten ergibt sich aus seiner besten Toplistenleistung.
- **Punkte je Ergebnis:** `(max(0, WA-Punkte − 1000) × Leistungsfaktor + WA-Platzierungspunkte × Platzierungsfaktor) × Disziplinfaktor`;
  Cross nur Platzierungspunkte × Cross-Faktor. Vorrunden zählen bei OW/DF/GW/GL (Q/q bzw. Gesamtplatz der Runde), geteilte Finals werden kombiniert.
  Schwellen und Faktoren sind im Admin-Bereich unter „Punkte und Athletenpool“ änderbar (gilt für alle Ligen).

Alle Details stehen in der App unter Mehr → Regeln.

## Automatische Abläufe

Der Zeitplaner läuft in der Datenbank (pg_cron, alle 15 Minuten, `scheduler_tick`): Er arbeitet fällige Fristen ab und startet die Workflows über die GitHub-API.

| Workflow | Wann | Was |
|---|---|---|
| Athletenpool laden (World Athletics) | täglich 6 Uhr | DE-Toplisten → Athleten, Disziplingruppe, Pool-Rang |
| Ergebnisse laden (World Athletics) | täglich 7 und 21 Uhr | Ergebnisse aller Pool- und Kader-Athleten, Punkte, Saisonwertung, Stichtage |
| Benachrichtigungen senden | nach jedem Ergebnisabruf und bei neuen Nachrichten | Web-Push (Waiver, Draft, „Du bist dran“, neue Punkte …) |
| Feedback senden | direkt nach dem Absenden in der App | E-Mail mit Text und Bildern an den Betreiber |
| App veröffentlichen | bei Änderungen an `web/` auf `main` | App auf GitHub Pages |
| Datenbank einrichten | bei Änderungen an `supabase/*.sql` auf `main` | Schema und Referenzdaten einspielen |
| Tests | bei jedem Push | TypeScript, App-Syntax, Datenbank- und Parser-Tests |
| Datenstand prüfen / Datenbank abfragen | per Knopfdruck | Diagnose (nur lesend) |
| WA-Regeln und Beispieldaten laden | per Knopfdruck | z. B. wenn World Athletics neue Ranking-Regeln veröffentlicht |

## Secrets (GitHub → Settings → Secrets and variables → Actions)

| Secret | Wofür |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | App (der anon-Key darf öffentlich sein) |
| `SUPABASE_SERVICE_KEY` | Datenabruf und Push-Versand |
| `SUPABASE_DB_URL` | Schema einspielen, Diagnose |
| `GH_DISPATCH_TOKEN` | Zeitplaner darf Workflows starten (wird in den Supabase-Vault übernommen) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `FEEDBACK_TO` | Feedback per E-Mail (optional) |
| `WA_API_URL`, `WA_API_KEY` | optional – sonst liest der Importer die Werte selbst von worldathletics.org |

## Einrichtung (einmalig)

1. **Supabase:** Projekt anlegen (Region Frankfurt). Unter *Database → Extensions* `pg_cron` und `pg_net` aktivieren.
2. **Secrets** anlegen (siehe oben). `GH_DISPATCH_TOKEN`: Fine-grained Token nur für dieses Repo mit „Actions: Read and write“.
3. **GitHub Pages** aktivieren: Settings → Pages → Source: *GitHub Actions*. (Bei einem privaten Repo braucht GitHub Pages ein kostenpflichtiges Konto – sonst das Repo öffentlich machen, wie bei UCI Fantasy.)
4. Auf `main` mergen – *Datenbank einrichten* und *App veröffentlichen* laufen automatisch.
5. **Daten laden:** Actions → *Athletenpool laden* → *Run workflow*; danach *Ergebnisse laden* mit Haken „Auch das Vorjahr laden“.
6. **Login-Weiterleitung:** Supabase → Authentication → URL Configuration → *Site URL* auf die App-Adresse.
7. **Google-Login (optional):** wie bei UCI Fantasy (OAuth-Client, Weiterleitung `https://<projekt>.supabase.co/auth/v1/callback`).

## Lokal testen

- **Logik:** `npm install`, dann `npm test`. Braucht ein PostgreSQL 16, in dem Datenbanken angelegt werden dürfen
  (`TEST_DATABASE_URL`, Standard: lokale Instanz auf Port 54329, Socket in `/tmp/fa-pg`).
- **Oberfläche:** `npx tsx tests/ui/seed.ts` legt eine Testdatenbank mit Liga an, `npx tsx tests/ui/mock-api.ts` bildet die
  Supabase-Schnittstelle darauf nach (RLS aktiv). `web/config.example.js` als `web/config.js` kopieren (URL `http://localhost:54321`),
  `python3 -m http.server -d web` starten und mit Playwright in der iPhone-Ansicht durchklicken (Sitzung per localStorage setzen).

## Hinweise

- World Athletics hat keine offizielle öffentliche API; der Abruf nutzt die Toplisten-Seiten und die GraphQL-Schnittstelle der
  Website mit Pausen zwischen den Abfragen.
- Athleten heißen intern weiter `riders` mit der ID `pcs_slug` (Format `wa-<World-Athletics-ID>`), damit die Spiellogik von
  UCI Fantasy unverändert nutzbar bleibt.
