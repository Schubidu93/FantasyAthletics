# Dokumentation: FantasyAthletics Projekt

## Überblick
Das **FantasyAthletics** Projekt ist ein Python-Skript zur automatischen Erfassung von Athletendaten und Wettkampfergebnissen von der World Athletics Website. Es scrapt Toplisten-Seiten, extrahiert Athleteninformationen und lädt anschließend deren Wettkampfergebnisse über die World Athletics GraphQL-API. Die Daten werden in CSV-Dateien gespeichert und können für Fantasy-Sport-Analysen verwendet werden.

## Dateien und deren Funktionen

### Konfigurationsdateien
- **`config.json`**: Enthält die API-Zugangsdaten für World Athletics
  - `api_url`: GraphQL-Endpunkt-URL
  - `api_key`: API-Schlüssel für Authentifizierung
  - `last_updated`: Datum der letzten Aktualisierung
  - `note`: Hinweis zur Aktualisierung der Credentials

- **`parameters.json`**: Steuerparameter für das Scraping und Laden
  - `scoreThreshold`: Mindestpunktzahl für Athleten (Standard: 975)
  - `years`: Liste der Jahre, für die Ergebnisse geladen werden sollen (z.B. [2023, 2024, 2025, 2026])

### Hauptskripte
- **`load_athletes.py`**: Hauptmodul zum Laden von Athleten aus Toplisten
  - Lädt Toplisten-Links aus `TopListLinks.xlsx` oder `toplist_links.csv`
  - Scrapt Athletendaten von World Athletics Toplisten-Seiten
  - Filtert Athleten nach Punktzahl-Schwellenwert
  - Speichert neue Athleten in `Athletenliste.csv`
  - Kann auch Ergebnisse für Athleten laden (siehe Ausführung)

- **`load_results.py`**: Modul zum Laden von Wettkampfergebnissen
  - Verwendet World Athletics GraphQL-API
  - Lädt Ergebnisse für einzelne Athleten oder alle Athleten aus der Liste
  - Formatiert Daten und speichert in `Ergebnisse.csv`
  - Behandelt API-Limits und Fehler

### Datendateien
- **`Athletenliste.csv`**: Liste aller erfassten Athleten
  - Spalten: Name, Profil-Link, WA-ID, Geschlecht, Geburtsjahr, Disziplin

- **`Ergebnisse.csv`**: Wettkampfergebnisse aller Athleten
  - Spalten: Athleten-ID, Datum, Wettkampf, Ort, Disziplin, Land, Kategorie, Platzierung, Ergebnis, Punkte, etc.

- **`TopListLinks.xlsx`** (oder `toplist_links.csv`): Links zu World Athletics Toplisten
  - Spalten: Männer-URL, Frauen-URL (oder einzelne Zeilen mit URL und Geschlecht)

### Verzeichnisse
- **`WorldAthletics_Data/`**: Ordner für zusätzliche Daten oder Cache-Dateien
- **`__pycache__/`**: Python-Bytecode-Cache (automatisch generiert)

## Zusammenarbeit der Dateien

1. **Konfiguration laden**: Beide Skripte lesen `config.json` und `parameters.json` für API-Zugang und Parameter.

2. **Athleten laden**:
   - `load_athletes.py` liest Toplisten-Links
   - Scrapt HTML-Seiten von World Athletics
   - Extrahiert Athletendaten (Name, Profil-Link, WA-ID, Punkte)
   - Filtert nach `scoreThreshold`
   - Speichert in `Athletenliste.csv`

3. **Ergebnisse laden**:
   - `load_results.py` liest `Athletenliste.csv`
   - Für jeden Athleten: API-Aufruf an World Athletics GraphQL
   - Lädt Ergebnisse für konfigurierte Jahre
   - Formatiert und speichert in `Ergebnisse.csv`

4. **Integration**: `load_athletes.py` importiert `load_results.py` für Ergebnis-Funktionen.

## Ausführung

### Voraussetzungen
- Python 3.7+
- Erforderliche Pakete: `requests`, `openpyxl` (für Excel-Dateien)
- Gültige World Athletics API-Credentials in `config.json`

### Installation
```bash
# Virtuelle Umgebung erstellen (empfohlen)
python -m venv .venv
.venv\Scripts\activate  # Windows
# oder .venv/bin/activate  # Linux/Mac

# Pakete installieren
pip install requests openpyxl
```

### Ausführungsmodi

#### 1. Athleten von Toplisten laden
```bash
python load_athletes.py
```
- Lädt neue Athleten aus `TopListLinks.xlsx`
- Aktualisiert `Athletenliste.csv`
- Verwendet `scoreThreshold` aus `parameters.json`

#### 2. Ergebnisse für alle Athleten laden
```bash
python load_athletes.py fetch_results
```
- Lädt Wettkampfergebnisse für alle Athleten in `Athletenliste.csv`
- Speichert in `Ergebnisse.csv`
- Verwendet Jahre aus `parameters.json`

#### 4. Automatisches Batch-Loading
```bash
python auto_batch_load.py
```
- Lädt Ergebnisse automatisch in Batches mit Pausen dazwischen
- Konfiguriere `batchSize` (Anzahl Athleten pro Batch) und `intervalMinutes` (Wartezeit zwischen Batches) in `parameters.json`
- Beispiel: `"batchSize": 10, "intervalMinutes": 5` lädt 10 Athleten, wartet 5 Minuten, lädt nächste 10, etc.
- Stoppt automatisch, wenn alle Athleten verarbeitet sind

### Logging
Alle Skripte verwenden Python-Logging. Ausgaben werden in der Konsole angezeigt mit Zeitstempel und Level (INFO, WARNING, ERROR).

### Fehlerbehandlung
- API-Fehler werden geloggt und übersprungen
- Duplikate in CSV-Dateien werden automatisch entfernt
- Fehlende Konfigurationsdateien werden mit Standardwerten erstellt

### Hinweise
- Die World Athletics API hat Ratenlimits - das Skript enthält automatische Delays und Retry-Logic bei Fehlern
- Bei "Too Many Requests" (429) wartet das Skript automatisch mit exponential backoff
- API-Credentials müssen regelmäßig aktualisiert werden (siehe `config.json`)
- Für große Athletenlisten kann das Laden der Ergebnisse mehrere Stunden dauern
- Die Skripte sind robust gegenüber Netzwerkfehlern und versuchen automatisch wiederholte Aufrufe</content>
<parameter name="filePath">c:\Users\julia\Documents\Python Scripts\FantasyAthletics\README.md