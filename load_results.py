import csv
import json
import logging
import re
from pathlib import Path
from datetime import datetime
import requests

# Configure logging (module-level logger will use root configuration from main script)

# Files
PARAM_FILE = Path('parameters.json')
ATHLETES_CSV = Path('Athletenliste.csv')
RESULTS_CSV = Path('Ergebnisse.csv')
RESULTS_WRITE_BATCH = 200


def load_api_config():
    """Read API url and key (and optional batch settings) from parameters.json.
    Accepts keys: apiUrl/apiKey or url/key, and optional batchSize, startRow, totalAthletes.
    """
    if not PARAM_FILE.exists():
        logging.error(f"{PARAM_FILE} not found; cannot load API config.")
        return {}
    try:
        with PARAM_FILE.open('r', encoding='utf-8') as f:
            cfg = json.load(f)
    except Exception as e:
        logging.error(f"Failed to read {PARAM_FILE}: {e}")
        return {}

    api_url = cfg.get('apiUrl') or cfg.get('url') or cfg.get('api_url') or cfg.get('endpoint')
    api_key = cfg.get('apiKey') or cfg.get('key') or cfg.get('api_key')
    batch_size = int(cfg.get('batchSize', cfg.get('batch_size', 0) or 0))
    start_row = int(cfg.get('startRow', cfg.get('start_row', 2)))
    total_athletes = int(cfg.get('totalAthletes', cfg.get('total_athletes', 0) or 0))
    return {'api_url': api_url, 'api_key': api_key, 'batch_size': batch_size, 'start_row': start_row, 'total_athletes': total_athletes}


def format_date(date_str: str) -> str:
    if not date_str:
        return ''
    parts = date_str.strip().split()
    if len(parts) < 3:
        return date_str
    day = parts[0].zfill(2)
    month_str = parts[1].upper()[:3]
    months = {'JAN':'01','FEB':'02','MAR':'03','APR':'04','MAY':'05','JUN':'06','JUL':'07','AUG':'08','SEP':'09','OCT':'10','NOV':'11','DEC':'12'}
    month = months.get(month_str, '01')
    year = parts[2]
    return f"{day}.{month}.{year}"


def format_time(time_str: str, discipline: str) -> str:
    if not time_str:
        return ''
    if ':' not in time_str:
        return time_str
    discipline = (discipline or '').lower()
    if 'road' in discipline or 'cross' in discipline or 'marathon' in discipline:
        parts = time_str.split(':')
        if len(parts) == 2:
            return f"00:{parts[0].zfill(2)}:{parts[1].zfill(2)}"
        if len(parts) == 3:
            return f"{parts[0].zfill(2)}:{parts[1].zfill(2)}:{parts[2].zfill(2)}"
        return time_str
    parts = time_str.split(':')
    if len(parts) < 2:
        return time_str
    minutes = parts[0].zfill(2)
    sec_frac = parts[1].split('.')
    seconds = sec_frac[0].zfill(2)
    millis = sec_frac[1] if len(sec_frac) > 1 else '00'
    millis = millis.ljust(2, '0')[:2]
    return f"{minutes}:{seconds},{millis}"


def current_timestamp() -> str:
    now = datetime.now()
    return now.strftime('%d.%m.%Y %H:%M:%S')


def fetch_athlete_results_via_api(athlete_id: int, year: int, api_url: str, api_key: str):
    query = {
        'operationName': 'GetSingleCompetitorResultsDate',
        'variables': {
            'resultsByYear': int(year),
            'resultsByYearOrderBy': 'date',
            'id': int(athlete_id)
        },
        'query': '''
      query GetSingleCompetitorResultsDate($id: Int, $resultsByYearOrderBy: String, $resultsByYear: Int) {
        getSingleCompetitorResultsDate(id: $id, resultsByYear: $resultsByYear, resultsByYearOrderBy: $resultsByYearOrderBy) {
          resultsByDate {
            date
            competition
            venue
            discipline
            country
            category
            race
            place
            mark
            resultScore
            remark
            competitionId
            eventId
          }
        }
      }
    '''
    }
    headers = {'Content-Type': 'application/json'}
    if api_key:
        headers['x-api-key'] = api_key
    try:
        resp = requests.post(api_url, json=query, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        if data and isinstance(data, dict):
            dd = data.get('data', {})
            payload = dd.get('getSingleCompetitorResultsDate') or {}
            return payload.get('resultsByDate') or []
    except Exception as e:
        logging.error(f"API request failed for athlete {athlete_id} year {year}: {e}")
    return []


def get_combined_placement(athlete_name: str, result: dict) -> tuple:
    race = result.get('race', '')
    place = result.get('place') or ''
    if race == 'F' and place:
        return place, race
    if isinstance(race, str) and race.startswith('F') and len(race) > 1 and race[1:].isdigit():
        comp_id = result.get('competitionId')
        event_id = result.get('eventId')
        if not comp_id or not event_id:
            return '', race
        url = f"https://worldathletics.org/competition/calendar-results/results/{comp_id}?eventId={event_id}"
        try:
            text = requests.get(url, timeout=20).text
        except Exception:
            return '', race
        final_blocks = re.findall(r'<strong>Final<!-- -->\\s*(\\d+)</strong>[\\s\\S]*?<table[\\s\\S]*?</table>', text, re.I)
        if not final_blocks:
            return '', race
        all_results = []
        for block in final_blocks:
            rows = re.findall(r'<tr[^>]*>[\\s\\S]*?<td[^>]*>(\\d+\.)</td>[\\s\\S]*?EventResults_name[^>]*?><a[^>]*>(.*?)</a>[\\s\\S]*?<td[^>]*>([\\d:.]+)</td>', text, re.I)
            for m in rows:
                pname = re.sub(r'<[^>]+>', '', m[1]).strip()
                ptime = m[2].strip()
                try:
                    tsec = time_to_seconds(ptime)
                except Exception:
                    tsec = None
                if tsec is not None:
                    all_results.append({'name': pname, 'time': tsec})
        all_results.sort(key=lambda x: x['time'])
        target = normalize_name(athlete_name)
        for idx, entry in enumerate(all_results):
            if target in normalize_name(entry['name']):
                return f"{idx+1}.", 'F'
        return '', race
    return '', race


def time_to_seconds(time_str: str):
    parts = [p.replace(',', '.') for p in time_str.split(':')]
    parts = [float(p) for p in parts]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return float(parts[0])


def normalize_name(name: str) -> str:
    return re.sub(r'\\s+', ' ', (name or '').lower()).strip()


def write_results_rows(rows: list):
    headers = ['Athletenname', 'Datum', 'Wettkampf', 'Veranstaltungsort', 'Disziplin', 'Land', 'Kategorie', 'Rennen', 'Platz', 'Zeit', 'Punktzahl', 'Anmerkung', 'Timestamp', 'Quelle']
    exists = RESULTS_CSV.exists()
    try:
        with RESULTS_CSV.open('a', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            if not exists:
                writer.writerow(headers)
            for r in rows:
                writer.writerow(r)
    except Exception as e:
        logging.error(f"Failed to write results to {RESULTS_CSV}: {e}")


def load_existing_result_keys() -> set:
    """Load existing results keys from RESULTS_CSV to avoid refetching/writing duplicates.
    Key = 'name|date|discipline|race'
    """
    keys = set()
    if not RESULTS_CSV.exists():
        return keys
    try:
        with RESULTS_CSV.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for r in reader:
                if not r or len(r) < 8:
                    continue
                key = f"{r[0]}|{r[1]}|{r[4]}|{r[7]}"
                keys.add(key)
    except Exception as e:
        logging.warning(f"Could not read existing results for dedupe: {e}")
    return keys


def remove_duplicates_results():
    if not RESULTS_CSV.exists():
        return
    try:
        with RESULTS_CSV.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader, None)
            rows = [r for r in reader if r]
        unique_map = {}
        for r in rows:
            key = f"{r[0]}|{r[1]}|{r[4]}|{r[7]}"
            ts = r[-2] if len(r) >= 2 else ''
            if key in unique_map:
                if ts > unique_map[key][-2]:
                    unique_map[key] = r
            else:
                unique_map[key] = r
        new_rows = list(unique_map.values())
        def parse_date(d):
            try:
                day, month, year = d.split('.')
                return int(year), int(month), int(day)
            except Exception:
                return (0, 0, 0)
        new_rows.sort(key=lambda x: parse_date(x[1]), reverse=True)
        with RESULTS_CSV.open('w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            if header:
                writer.writerow(header)
            writer.writerows(new_rows)
    except Exception as e:
        logging.error(f"Error deduplicating {RESULTS_CSV}: {e}")


def fetch_results_for_config_athletes():
    """Read athletes from Athletenliste.csv and for configured years fetch results via API and save to Ergebnisse.csv.
    Uses API config from parameters.json (apiUrl, apiKey)."""
    cfg = load_api_config()
    api_url = cfg.get('api_url')
    api_key = cfg.get('api_key')
    batch_size = cfg.get('batch_size', 0)
    start_row = cfg.get('start_row', 2)
    total_athletes = cfg.get('total_athletes', 0)
    if not api_url:
        logging.error('API URL not configured in parameters.json (apiUrl / url). Aborting.')
        return
    # load years either from parameters.json default
    try:
        with PARAM_FILE.open('r', encoding='utf-8') as f:
            p = json.load(f)
            years = p.get('years', [2024, 2025, 2026])
    except Exception:
        years = [2024, 2025, 2026]

    if not ATHLETES_CSV.exists():
        logging.error(f"{ATHLETES_CSV} not found. Create athletes list first.")
        return

    try:
        with ATHLETES_CSV.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader, None)
            rows = list(reader)
    except Exception as e:
        logging.error(f"Failed to read {ATHLETES_CSV}: {e}")
        return

    if total_athletes and total_athletes > 0:
        last_row = total_athletes
    else:
        last_row = len(rows)
    if batch_size and batch_size > 0:
        end_row = min(start_row - 1 + batch_size, last_row)
    else:
        end_row = last_row

    results_rows = []
    existing_keys = load_existing_result_keys()
    write_batch = []
    start_idx = max(0, start_row - 2)
    end_idx = int(end_row) - 1
    for i in range(start_idx, end_idx + 1):
        try:
            r = rows[i]
        except IndexError:
            continue
        athlete_name = r[0].strip() if len(r) > 0 else ''
        profile_link = r[1].strip() if len(r) > 1 else ''
        athlete_id = None
        # try extract from link like in original helper
        m = re.search(r'athlete=(\d+)', profile_link)
        if m:
            athlete_id = m.group(1)
        else:
            m = re.search(r'-([0-9]{5,})', profile_link)
            if m:
                athlete_id = m.group(1)
        if not athlete_id:
            logging.warning(f"Could not extract athlete id for {athlete_name} from {profile_link}")
            continue
        for y in years:
            try:
                items = fetch_athlete_results_via_api(athlete_id, int(y), api_url, api_key)
                for res in items:
                    formatted_date = format_date(res.get('date', ''))
                    formatted_time = format_time(res.get('mark', ''), res.get('discipline', ''))
                    key = f"{athlete_name}|{formatted_date}|{res.get('discipline','')}|{res.get('race','')}"
                    if key in existing_keys:
                        continue
                    timestamp = current_timestamp()
                    combined = get_combined_placement(athlete_name, res)
                    if not combined:
                        continue
                    if isinstance(combined, dict):
                        combined_place = combined.get('place', '')
                        combined_race = combined.get('race', '')
                    elif isinstance(combined, (list, tuple)):
                        combined_place = combined[0] if len(combined) > 0 else ''
                        combined_race = combined[1] if len(combined) > 1 else ''
                    else:
                        combined_place, combined_race = '', ''
                    row_out = [
                        athlete_name,
                        formatted_date,
                        res.get('competition', ''),
                        res.get('venue', ''),
                        res.get('discipline', ''),
                        res.get('country', ''),
                        res.get('category', ''),
                        combined_race,
                        combined_place,
                        formatted_time,
                        res.get('resultScore', ''),
                        res.get('remark', ''),
                        timestamp,
                        'World Athletics'
                    ]
                    write_batch.append(row_out)
                    existing_keys.add(key)
                    if len(write_batch) >= RESULTS_WRITE_BATCH:
                        write_results_rows(write_batch)
                        write_batch = []
            except Exception as e:
                logging.error(f"Error processing athlete {athlete_name} year {y}: {e}")

    # flush remaining
    if write_batch:
        write_results_rows(write_batch)
    if write_batch or results_rows:
        remove_duplicates_results()
        # note: len(results_rows) not accurate after batching; log total via existing_keys size change not tracked here
        logging.info(f"Wrote results to {RESULTS_CSV}")
    else:
        logging.info('No results found to write.')


def find_athlete_name_by_waid(wa_id: str) -> str:
    """Try to find athlete name in `Athletenliste.csv` by World Athletics ID or link containing the id."""
    if not wa_id:
        return ''
    if not ATHLETES_CSV.exists():
        return ''
    try:
        with ATHLETES_CSV.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader, None)
            wa_idx = None
            link_idx = None
            name_idx = 0
            if header:
                for i, h in enumerate(header):
                    hn = (h or '').strip().lower()
                    if hn == 'world athletics id':
                        wa_idx = i
                    if hn == 'world athletics link' or 'link' in hn:
                        link_idx = i
            for row in reader:
                if not row:
                    continue
                if wa_idx is not None and len(row) > wa_idx and row[wa_idx].strip() == str(wa_id):
                    return row[name_idx].strip()
                if link_idx is not None and len(row) > link_idx and str(wa_id) in (row[link_idx] or ''):
                    return row[name_idx].strip()
    except Exception:
        return ''
    return ''


def fetch_results_for_athlete(athlete_id: str, write: bool = True) -> list:
    cfg = load_api_config()
    api_url = cfg.get('api_url')
    api_key = cfg.get('api_key')
    if not api_url:
        logging.error('API URL not configured in parameters.json (apiUrl / url). Aborting.')
        return []
    try:
        with PARAM_FILE.open('r', encoding='utf-8') as f:
            p = json.load(f)
            years = p.get('years', [2024, 2025, 2026])
    except Exception:
        years = [2024, 2025, 2026]
    athlete_name = find_athlete_name_by_waid(str(athlete_id))
    results_rows = []
    existing_keys = load_existing_result_keys()
    write_batch = []
    for y in years:
        items = fetch_athlete_results_via_api(athlete_id, int(y), api_url, api_key)
        for res in items:
            formatted_date = format_date(res.get('date', ''))
            key = f"{athlete_name}|{formatted_date}|{res.get('discipline','')}|{res.get('race','')}"
            if key in existing_keys:
                continue
            timestamp = current_timestamp()
            combined = get_combined_placement(athlete_name, res)
            if not combined:
                continue
            if isinstance(combined, dict):
                combined_place = combined.get('place', '')
                combined_race = combined.get('race', '')
            elif isinstance(combined, (list, tuple)):
                combined_place = combined[0] if len(combined) > 0 else ''
                combined_race = combined[1] if len(combined) > 1 else ''
            else:
                combined_place, combined_race = '', ''
            row_out = [
                athlete_name or '',
                formatted_date,
                res.get('competition', ''),
                res.get('venue', ''),
                res.get('discipline', ''),
                res.get('country', ''),
                res.get('category', ''),
                combined_race,
                combined_place,
                format_time(res.get('mark', ''), res.get('discipline', '')),
                res.get('resultScore', ''),
                res.get('remark', ''),
                timestamp,
                'World Athletics'
            ]
            write_batch.append(row_out)
            existing_keys.add(key)
            results_rows.append(row_out)
            if len(write_batch) >= RESULTS_WRITE_BATCH:
                write_results_rows(write_batch)
                write_batch = []

    if write and write_batch:
        write_results_rows(write_batch)
    if write and (write_batch or results_rows):
        remove_duplicates_results()
        logging.info(f"Wrote {len(results_rows)} results for athlete {athlete_id} to {RESULTS_CSV}")

    return results_rows
