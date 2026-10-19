# Fantasy Athletics

Fantasy-Leichtathletik für eine Freundesrunde: Über eine Saison (Januar–Dezember) sammelt jedes Team Punkte mit deutschen Läuferinnen und Läufern. Die Ergebnisse kommen automatisch von World Athletics.

Löst die alte Lösung aus Google Sheets, Apps Script und AppSheet ab.

## Spielregeln (Standard, pro Saison im Admin-Bereich änderbar)

| | |
|---|---|
| **Athletenpool** | DE-Toplisten (Senioren) des Saisonjahres und des Vorjahres, alle Laufdisziplinen ab 800 m inkl. Hindernis, Halle und Straße. Wer dort ≥ **1000 WA-Punkte** hat, ist im Pool. Wird täglich aktualisiert. |
| **Draft** | Snake-Draft live in der App, **11 Runden** (= Kadergröße). |
| **Aufstellung** | Pro Spieltag 8 Positionen: 800, 1500, 5000, 10000, Marathon, Hindernis + 2 Wildcards. Auf eine Gruppen-Position dürfen nur Athleten dieser Gruppe. Die Gruppe ergibt sich aus der besten Toplistenleistung, Admins können sie in `athletes.group_override` überschreiben. |
| **Spieltage** | Frei definierbare Zeiträume, z. B. alle 14 Tage. Ab Spieltagsbeginn ist die Aufstellung gesperrt. Nur leere Positionen und Positionen, deren Athlet nicht mehr im Kader ist, dürfen noch besetzt werden. Eine Aufstellung gilt weiter, bis man sie ändert. |
| **Transfers** | Free Agents aus dem Pool holen, sofort und nach dem Prinzip „wer zuerst kommt“. Trades zwischen Teams, die das andere Team annehmen muss. |
| **Punkte je Ergebnis** | `(max(0, WA-Punkte − 1000) × Leistungsfaktor + Platzierungspunkte × Platzierungsfaktor) × Disziplinfaktor` |

- **Platzierungspunkte** richten sich nach den WA-World-Ranking-Tabellen. Sie hängen ab von Disziplingruppe, Wettkampfkategorie (OW, DF, GW, GL, A–F), Finale oder Halbfinale und Platz. Vorläufe und gesplittete Finals (F1, F2 …) bekommen keine Platzierungspunkte.
- **Disziplinfaktoren** sind z. B. Marathon 3, Halbmarathon 2, 10.000 m 1,6, Gehen 0. Die Tabellen `disciplines` und `placing_scores` sind aus dem alten Google Sheet übernommen.
- **Wann ein Ergebnis zählt:** wenn der Athlet im Spieltag aufgestellt war **und** am Wettkampftag im Kader des Teams stand.

## Architektur

```
Next.js (Vercel)  ──►  Supabase (Postgres + Auth + Realtime)  ◄──  GitHub Actions (Importer)
     App/PWA            Regeln als SQL-Funktionen, Punkte als Views       Toplisten + WA-GraphQL
```

| Pfad | Inhalt |
|---|---|
| `supabase/migrations/` | Schema, Views für Punkte und Tabellen, alle Spielregeln als RPC-Funktionen, Row Level Security, Referenzdaten |
| `app/`, `components/`, `lib/` | Web-App (Next.js App Router, Tailwind), installierbar als App auf dem Handy |
| `importer/` | `sync-pool.ts` (Toplisten scrapen), `sync-results.ts` (Ergebnisse über die WA-GraphQL-API). Der API-Key wird automatisch von worldathletics.org gelesen, wenn er fehlt oder abgelaufen ist. |
| `tests/` | Tests der Spielregeln gegen die echten Migrationen (PGlite) und des WA-Parsers |

## Einrichtung

### 1. Supabase

1. Unter [supabase.com](https://supabase.com) ein neues Projekt anlegen (Free Tier reicht).
2. Migrationen einspielen. Entweder mit der CLI:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   Oder den Inhalt der Dateien aus `supabase/migrations/` der Reihe nach im SQL Editor ausführen.
3. Unter **Authentication → URL Configuration**:
   - Site URL: `https://<deine-app>.vercel.app`
   - Redirect URL: `https://<deine-app>.vercel.app/auth/confirm`
4. Unter **Authentication → Email Templates → Magic Link** das Template so anpassen, dass auch der Code drinsteht. Das ist wichtig für die installierte App auf dem iPhone, weil sich Links dort in Safari öffnen:
   ```html
   <h2>Login für Fantasy Athletics</h2>
   <p>Dein Code: <b>{{ .Token }}</b></p>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Oder hier klicken</a></p>
   ```
5. Optional: Unter **Authentication → Providers → Email** „Allow new users to sign up“ ausschalten, sobald alle registriert sind.

### 2. Vercel

1. Repo in Vercel importieren (Framework: Next.js).
2. Environment Variables setzen (Werte aus Supabase → Project Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 3. GitHub Actions (Import)

Unter **Settings → Secrets and variables → Actions**:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (der **service_role**-Key, niemals in der App verwenden!)
- optional `WA_API_URL` / `WA_API_KEY`

Danach unter **Actions → WA-Import → Run workflow** einmal mit `both` starten. Zeitplan:
- Pool: täglich um 05:17 Uhr
- Ergebnisse: alle 4 Stunden

### 4. Saison starten

1. In der App anmelden und eine **neue Saison anlegen**. Wer sie anlegt, ist Admin.
2. Den Einladungscode aus dem Admin-Bereich an die Mitspieler schicken. Die melden sich an und treten mit dem Code bei.
3. Im Admin-Bereich:
   - Spieltage erzeugen
   - Draft-Reihenfolge festlegen oder auslosen
   - Draft starten
4. Nach dem Draft stellt jedes Team unter „Mein Team“ seine Aufstellung auf.

Um sich selbst zum globalen Admin zu machen (darf u. a. Disziplinfaktoren ändern), im SQL Editor ausführen:
`update profiles set is_admin = true where id = (select id from auth.users where email = 'du@example.com');`

## Entwicklung

```bash
npm install
cp .env.example .env.local   # Supabase-URL und Anon-Key eintragen
npm run dev
npm test                     # Spielregeln + Parser
npm run lint                 # TypeScript
```

Den Importer lokal ausführen (braucht `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` in der Umgebung):

```bash
npm run import:pool
npm run import:results
```

### Ergebnisse manuell nachtragen

Für Wettkämpfe, die nicht bei World Athletics stehen: im Supabase Table Editor eine Zeile in `results` mit `source = 'manual'` anlegen. Punkte und Tabellen rechnen sich automatisch neu, weil alles Views sind.
