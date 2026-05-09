import requests
from bs4 import BeautifulSoup
import pandas as pd
import re

def extract_athletes(discipline: str, year: int, gender: str, min_score: int, area: str = "all", country: str = None):
    # Mapping zur Linkgenerierung
    gender_map = {"m": "men", "w": "women"}
    discipline_path = discipline.lower().replace(" ", "-")
    region_type = "world"
    region = area

    if country:
        region_type = "countries"
        region = country.lower()

    # URL bauen
    url = (
        f"https://worldathletics.org/records/toplists/middlelong/{discipline_path}/all/"
        f"{gender_map[gender]}/senior/{year}?regionType={region_type}&region={region}"
    )

    # HTML abrufen
    response = requests.get(url)
    if response.status_code != 200:
        raise Exception(f"Fehler beim Abrufen der Seite: {response.status_code}")

    soup = BeautifulSoup(response.content, "html.parser")
    table = soup.find("table", class_="records-table")

    if not table:
        raise Exception("Tabelle nicht gefunden")

    athletes = []

    rows = table.find("tbody").find_all("tr")
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 11:
            continue

        try:
            score = int(cells[10].text.strip())
        except ValueError:
            continue

        if score > min_score:
            name = cells[3].text.strip()
            link_tag = cells[3].find("a")
            link = "https://worldathletics.org" + link_tag['href'] if link_tag else ""
            dob_text = cells[4].text.strip()
            dob_match = re.search(r'\d{4}', dob_text)
            birth_year = int(dob_match.group()) if dob_match else None

            athletes.append({
                "Athlet": name,
                "Link": link,
                "Gender": gender,
                "Year": birth_year
            })

    return pd.DataFrame(athletes)

df = extract_athletes(discipline="800 Metres", year=2025, gender="m", country="GER", min_score=1100)
print(df)
