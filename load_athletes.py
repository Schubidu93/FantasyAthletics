import csv
import json
import logging
import re
import sys
from pathlib import Path
import html
import requests
import urllib.parse

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')

# Filenames
TOPLIST_CSV = Path('toplist_links.csv')
PARAM_FILE = Path('parameters.json')
ATHLETES_CSV = Path('Athletenliste.csv')

# Defaults
DEFAULT_THRESHOLD = 975
MAX_PAGES = 10


def load_parameters():
    """Load parameters.json and return (threshold, years).
    If missing, create with defaults (threshold and years list).
    """
    defaults = {'scoreThreshold': DEFAULT_THRESHOLD, 'years': [2024, 2025, 2026]}
    if PARAM_FILE.exists():
        try:
            with PARAM_FILE.open('r', encoding='utf-8') as f:
                cfg = json.load(f)
                threshold = int(cfg.get('scoreThreshold', DEFAULT_THRESHOLD))
                years = cfg.get('years', defaults['years'])
                # normalize years to int list
                years = [int(y) for y in years]
                logging.info(f"Loaded parameters from {PARAM_FILE}: threshold={threshold}, years={years}")
                return threshold, years
        except Exception as e:
            logging.warning(f"Could not read {PARAM_FILE}: {e}")
    # create with defaults
    try:
        with PARAM_FILE.open('w', encoding='utf-8') as f:
            json.dump(defaults, f, ensure_ascii=False, indent=2)
        logging.info(f"Created default {PARAM_FILE} with {defaults}")
    except Exception as e:
        logging.error(f"Could not create {PARAM_FILE}: {e}")
    return defaults['scoreThreshold'], defaults['years']


def load_threshold():
    """Load threshold from parameters.json (key: scoreThreshold) or ask the user."""
    # Always use parameters.json. If missing, create it with default threshold.
    if PARAM_FILE.exists():
        try:
            with PARAM_FILE.open('r', encoding='utf-8') as f:
                cfg = json.load(f)
                val = int(cfg.get('scoreThreshold', DEFAULT_THRESHOLD))
                logging.info(f"Loaded score threshold {val} from {PARAM_FILE}")
                return val
        except Exception as e:
            logging.warning(f"Could not read {PARAM_FILE}: {e}")
    # create parameters.json with default threshold and return it
    try:
        with PARAM_FILE.open('w', encoding='utf-8') as f:
            json.dump({'scoreThreshold': DEFAULT_THRESHOLD}, f, ensure_ascii=False, indent=2)
        logging.info(f"Created {PARAM_FILE} with default scoreThreshold={DEFAULT_THRESHOLD}")
    except Exception as e:
        logging.error(f"Could not create {PARAM_FILE}: {e}")
    return DEFAULT_THRESHOLD


def load_toplist_links():
    """Read toplist links from TOPLIST_CSV. Supports a few layouts:
    - CSV with headers 'url','gender' per row
    - CSV with headers 'men','women' where each row has corresponding links
    - Plain CSV rows where first column = men, second column = women
    Returns a list of dicts: {'url':..., 'gender': 'm'|'w', 'discipline': ...}
    """
    # Prefer Excel file `TopListLinks.xlsx` if present
    excel_path = Path('TopListLinks.xlsx')
    if excel_path.exists():
        logging.info(f"Reading toplist links from Excel: {excel_path}")
        try:
            try:
                from openpyxl import load_workbook
                wb = load_workbook(excel_path, read_only=True, data_only=True)
                sheet = wb.active
                entries = []
                # read column B (index 2) and C (index 3), starting from row 2
                for row in sheet.iter_rows(min_row=2, min_col=2, max_col=3, values_only=True):
                    men_cell, women_cell = row[0], row[1] if len(row) > 1 else None
                    if men_cell and str(men_cell).strip():
                        entries.append({'url': str(men_cell).strip(), 'gender': 'm', 'discipline': ''})
                    if women_cell and str(women_cell).strip():
                        entries.append({'url': str(women_cell).strip(), 'gender': 'w', 'discipline': ''})
                return entries
            except Exception:
                # fallback to pandas if openpyxl not available or failed
                import pandas as pd
                df = pd.read_excel(excel_path)
                entries = []
                # try to detect columns B and C by position
                for idx, row in df.iterrows():
                    # pandas uses 0-based index
                    men = row.iloc[1] if len(row) > 1 else None
                    women = row.iloc[2] if len(row) > 2 else None
                    if pd.notna(men):
                        entries.append({'url': str(men).strip(), 'gender': 'm', 'discipline': ''})
                    if pd.notna(women):
                        entries.append({'url': str(women).strip(), 'gender': 'w', 'discipline': ''})
                return entries
        except ModuleNotFoundError:
            logging.error('openpyxl or pandas not installed. Install openpyxl (pip install openpyxl) to read Excel files.')
            return []

    # Fallback to CSV file
    if not TOPLIST_CSV.exists():
        logging.error(f"Toplist links file not found: {TOPLIST_CSV} and TopListLinks.xlsx missing.")
        return []

    entries = []
    with TOPLIST_CSV.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        # Normalize header
        if header:
            lower = [h.strip().lower() for h in header]
            if 'url' in lower and 'gender' in lower:
                # use DictReader
                f.seek(0)
                for row in csv.DictReader(f):
                    url = (row.get('url') or row.get('link') or '').strip()
                    gender = (row.get('gender') or 'm').strip().lower()
                    discipline = row.get('discipline', '') if isinstance(row, dict) else ''
                    if url:
                        entries.append({'url': url, 'gender': 'm' if gender.startswith('m') else 'w', 'discipline': discipline})
                return entries
            if 'men' in lower or 'women' in lower:
                # columns named men/women
                men_i = lower.index('men') if 'men' in lower else None
                women_i = lower.index('women') if 'women' in lower else None
                for r in reader:
                    if men_i is not None and len(r) > men_i and r[men_i].strip():
                        entries.append({'url': r[men_i].strip(), 'gender': 'm', 'discipline': ''})
                    if women_i is not None and len(r) > women_i and r[women_i].strip():
                        entries.append({'url': r[women_i].strip(), 'gender': 'w', 'discipline': ''})
                return entries
            # else treat as plain two-column CSV: men,women
            # rewind first row into processing
            f.seek(0)
            for r in csv.reader(f):
                if not r:
                    continue
                if len(r) == 1:
                    entries.append({'url': r[0].strip(), 'gender': 'm', 'discipline': ''})
                else:
                    if r[0].strip():
                        entries.append({'url': r[0].strip(), 'gender': 'm', 'discipline': ''})
                    if r[1].strip():
                        entries.append({'url': r[1].strip(), 'gender': 'w', 'discipline': ''})
    return entries


def replace_year_in_url(url: str, target_year: int, candidate_years=None) -> str:
    s = str(url)
    if candidate_years:
        for y in candidate_years:
            ystr = str(y)
            if ystr in s:
                s = s.replace(ystr, str(target_year))
                return s
    # try replacing first path-year like /2026
    s2 = re.sub(r'/(?P<y>20\d{2})(?=[/?])', f'/{target_year}', s, count=1)
    if s2 != s:
        return s2
    # try replacing year=2026 query param
    s2 = re.sub(r'([?&]year=)(20\d{2})', f'\1{target_year}', s, count=1)
    if s2 != s:
        return s2
    # no year found: append year param
    if '?' in s:
        return s + f'&year={target_year}'
    return s + f'?year={target_year}'


def expand_entries_for_years(entries: list, years: list) -> list:
    """Duplicate and replace year token in URLs for each target year."""
    if not entries:
        return []
    expanded = []
    candidate_years = years[:]  # use same list to detect in URLs
    # also include 2026 as common default if not present
    if 2026 not in candidate_years:
        candidate_years.append(2026)
    for e in entries:
        url = e.get('url', '')
        for y in years:
            new_url = replace_year_in_url(url, int(y), candidate_years)
            new_entry = e.copy()
            new_entry['url'] = new_url
            new_entry['year'] = int(y)
            expanded.append(new_entry)
    return expanded


def is_valid_url(url: str) -> bool:
    pattern = re.compile(r'^(https?:\/\/[^\s$.?#].[^\s]*)$', re.I)
    return bool(pattern.match(url))


def decode_html_entities(s: str) -> str:
    if not s:
        return s
    # basic unescape plus some fixes
    out = html.unescape(s)
    # replace some numeric codes common on WA pages
    out = out.replace('&#220;', 'Ü').replace('&#228;', 'ä').replace('&#246;', 'ö').replace('&#196;', 'Ä')
    out = out.replace('&#214;', 'Ö').replace('&#223;', 'ß').replace('&#201;', 'É').replace('&#233;', 'é')
    return out.strip()


def fetch_toplist(url: str, gender: str, score_threshold: int):
    """Fetch a toplist page (and follow simple pagination) and return rows of athlete dicts."""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/1.0)"}
    results = []
    to_fetch = [url]
    fetched = set()

    try:
        while to_fetch and len(fetched) < MAX_PAGES:
            page_url = to_fetch.pop(0)
            if page_url in fetched:
                continue
            logging.info(f"Fetching toplist page: {page_url}")
            resp = requests.get(page_url, headers=headers, timeout=15)
            resp.raise_for_status()
            text = resp.text
            fetched.add(page_url)

            rows = re.findall(r'<tr[\s\S]*?>[\s\S]*?<\/tr>', text, re.I)
            for row in rows:
                comp = re.search(r'<td[^>]*data-th=["\']Competitor["\'][^>]*>[\s\S]*?<a[^>]*href=["\'](?P<href>[^"\']+)["\'][^>]*>(?P<name>[\s\S]*?)<\/a>', row, re.I)
                if not comp:
                    continue
                score_m = re.search(r'<td[^>]*data-th=["\']ResultScore["\'][^>]*>\s*(?P<score>\d+)\s*<\/td>', row, re.I)
                score = int(score_m.group('score')) if score_m else 0
                if score <= score_threshold:
                    continue
                dob_m = re.search(r'<td[^>]*data-th=["\']DOB["\'][^>]*>[\s\S]*?(?P<year>\d{4})', row, re.I)
                year_of_birth = dob_m.group('year') if dob_m else ''
                country_m = re.search(r'<td[^>]*data-th=["\']Country["\'][^>]*>[\s\S]*?(?P<c>[^<\n]+)', row, re.I)
                row_country = country_m.group('c').strip() if country_m else ''
                profile = comp.group('href').strip()
                name_raw = re.sub(r'<[^>]+>', '', comp.group('name')).strip()
                name = decode_html_entities(name_raw)
                full_profile = urllib.parse.urljoin(page_url, profile)
                athlete = {
                    'name': name,
                    'profile_link': full_profile,
                    'wa_id': extract_wa_id(full_profile),
                    'gender': 'Men' if gender.lower().startswith('m') else 'Women',
                    'birth_year': year_of_birth,
                    'score': score,
                    'country': row_country
                }
                results.append(athlete)

            # find next link
            m_next = re.search(r'<a[^>]+href=["\'](?P<h>[^"\']+)["\'][^>]*>(?:\s*Next\s*|›|»|&raquo;)</a>', text, re.I)
            if m_next:
                next_href = m_next.group('h')
                next_url = urllib.parse.urljoin(page_url, next_href)
                if next_url not in fetched and next_url not in to_fetch:
                    logging.info(f"Found next toplist page: {next_url}")
                    to_fetch.append(next_url)

        return results
    except Exception as e:
        logging.error(f"Error fetching toplist {url}: {e}")
        return results


def load_existing_names() -> set:
    """Load existing athlete names from ATHLETES_CSV first column."""
    if not ATHLETES_CSV.exists():
        return set()
    names = set()
    try:
        with ATHLETES_CSV.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if row:
                    names.add(row[0].strip())
    except Exception as e:
        logging.warning(f"Could not read existing athletes file: {e}")
    return names


def extract_wa_id(url: str) -> str:
    """Extract the World Athletics numeric ID from a profile URL, if present."""
    if not url:
        return ''
    # athlete=123456 pattern
    m = re.search(r'athlete=(\d+)', url)
    if m:
        return m.group(1)
    # trailing -123456 or -123456/ patterns
    m = re.search(r'-([0-9]{5,})', url)
    if m:
        return m.group(1)
    # digits at end of path
    m = re.search(r'/([0-9]{5,})/?$', url)
    if m:
        return m.group(1)
    return ''


def update_existing_wa_ids():
    """Populate missing World Athletics IDs in ATHLETES_CSV by extracting from profile links."""
    if not ATHLETES_CSV.exists():
        logging.info(f"{ATHLETES_CSV} not found, nothing to update.")
        return 0

    try:
        with ATHLETES_CSV.open('r', encoding='utf-8', newline='') as f:
            reader = csv.reader(f)
            rows = list(reader)
    except Exception as e:
        logging.error(f"Failed to read {ATHLETES_CSV}: {e}")
        return 0

    if not rows:
        logging.info(f"{ATHLETES_CSV} is empty.")
        return 0

    header = rows[0]
    # Ensure header has WA ID column
    if 'World Athletics ID' not in header:
        # Insert after 'World Athletics Link' if present, else at index 2
        try:
            link_idx = header.index('World Athletics Link')
            wa_idx = link_idx + 1
        except ValueError:
            wa_idx = 2
        header = header[:wa_idx] + ['World Athletics ID'] + header[wa_idx:]
        # adjust rows
        new_rows = [header]
        for r in rows[1:]:
            # ensure row has enough columns
            if len(r) <= wa_idx - 1:
                r = r + [''] * (wa_idx - len(r))
            r = r[:wa_idx] + [''] + r[wa_idx:]
            new_rows.append(r)
        rows = new_rows

    wa_idx = header.index('World Athletics ID')
    link_idx = header.index('World Athletics Link') if 'World Athletics Link' in header else 1

    updated = 0
    for i in range(1, len(rows)):
        row = rows[i]
        # ensure row length
        if len(row) <= wa_idx:
            row += [''] * (wa_idx - len(row) + 1)
        if not row[wa_idx].strip():
            profile = row[link_idx] if len(row) > link_idx else ''
            wa = extract_wa_id(profile)
            if wa:
                row[wa_idx] = wa
                updated += 1
        rows[i] = row

    try:
        with ATHLETES_CSV.open('w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerows(rows)
    except Exception as e:
        logging.error(f"Failed to write {ATHLETES_CSV}: {e}")
        return 0

    logging.info(f"Updated {updated} World Athletics IDs in {ATHLETES_CSV}")
    return updated


def append_athletes(new_rows: list):
    """Append new athlete rows (list of lists) to ATHLETES_CSV, create file with header if needed."""
    header = ['Name', 'World Athletics Link', 'World Athletics ID', 'Geschlecht', 'Jahrgang', 'Anmerkung']
    # If file doesn't exist, create with full header
    if not ATHLETES_CSV.exists():
        with ATHLETES_CSV.open('w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(header)
            for r in new_rows:
                writer.writerow(r)
        return

    # If file exists, check header and normalize existing rows to include WA ID column if missing
    try:
        with ATHLETES_CSV.open('r', encoding='utf-8', newline='') as f:
            reader = csv.reader(f)
            existing_header = next(reader, None)
            existing_rows = list(reader)
    except Exception:
        existing_header = None
        existing_rows = []

    if existing_header and 'World Athletics ID' not in existing_header:
        # rewrite file with new header, adding empty WA ID column for existing rows
        new_existing = []
        for row in existing_rows:
            # insert empty value after link (index 1) -> new index 2
            if len(row) >= 2:
                row = row[:2] + [''] + row[2:]
            else:
                row = row + [''] * (6 - len(row))
            new_existing.append(row)
        with ATHLETES_CSV.open('w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(header)
            writer.writerows(new_existing)
            for r in new_rows:
                writer.writerow(r)
        return

    # Default: append rows (assume header already correct)
    with ATHLETES_CSV.open('a', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        for r in new_rows:
            writer.writerow(r)


def remove_duplicates_in_csv():
    """Deduplicate ATHLETES_CSV by first column (Name)."""
    if not ATHLETES_CSV.exists():
        return
    rows = []
    try:
        with ATHLETES_CSV.open('r', encoding='utf-8') as f:
            reader = csv.reader(f)
            header = next(reader, None)
            for r in reader:
                if r:
                    rows.append(r)
        seen = set()
        unique = []
        for r in rows:
            key = r[0].strip()
            if key and key not in seen:
                seen.add(key)
                unique.append(r)
        with ATHLETES_CSV.open('w', encoding='utf-8', newline='') as f:
            writer = csv.writer(f)
            if header:
                writer.writerow(header)
            writer.writerows(unique)
    except Exception as e:
        logging.error(f"Error deduplicating {ATHLETES_CSV}: {e}")


def main():
    score_threshold, years = load_parameters()
    toplist_entries = load_toplist_links()
    # expand entries for each year
    toplist_entries = expand_entries_for_years(toplist_entries, years)
    if not toplist_entries:
        logging.error('No toplist links found. Create toplist_links.csv with links.')
        return

    existing = load_existing_names()
    new_rows = []

    for entry in toplist_entries:
        url = entry.get('url')
        gender = entry.get('gender', 'm')
        discipline = entry.get('discipline', '')
        if not url or not is_valid_url(url):
            logging.warning(f"Invalid or empty URL skipped: {url}")
            continue
        logging.info(f"Processing toplist URL: {url} (gender={gender})")
        athletes = fetch_toplist(url, gender, score_threshold)
        for a in athletes:
            name = a['name']
            if name in existing:
                continue
            existing.add(name)
            profile = a['profile_link']
            wa_id = a.get('wa_id', '')
            gender_label = a['gender']
            year = a['birth_year']
            new_rows.append([name, profile, wa_id, gender_label, year, discipline])

    if new_rows:
        append_athletes(new_rows)
        remove_duplicates_in_csv()
        logging.info(f"Added {len(new_rows)} new athletes to {ATHLETES_CSV}")
    else:
        logging.info('No new athletes to add.')


if __name__ == '__main__':
    main()
