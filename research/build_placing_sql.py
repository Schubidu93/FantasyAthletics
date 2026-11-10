# Erzeugt supabase/reference_data.sql: Disziplinen (research/disciplines.txt) und die
# WA-Platzierungstabellen 2026 aus den gesicherten Regelseiten (research/out/rules/*.txt).
# Aufruf aus dem Repo-Hauptordner: python3 research/build_placing_sql.py
import re, sys

def tables(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out, i = {}, 0
    while i < len(lines):
        m = re.match(r"^Table (\d+\.\d+)\.", lines[i])
        if m and i + 1 < len(lines) and lines[i + 1].startswith("Place |"):
            head = [h.strip() for h in lines[i + 1].split("|")[1:]]
            rows, j = [], i + 2
            while j < len(lines) and "|" in lines[j]:
                rows.append([c.strip() for c in lines[j].split("|")])
                j += 1
            out[m.group(1)] = (head, rows)
            i = j
        else:
            i += 1
    return out

def place_of(label, idx):
    label = label.replace("*", "").strip()
    if label.startswith("Q or q"):
        return [0]
    m = re.match(r"^(\d+)-(\d+)th$", label)
    if m:
        return list(range(int(m.group(1)), int(m.group(2)) + 1))
    m = re.match(r"^(\d+)(st|nd|rd|th)$", label)
    if m:
        return [int(m.group(1))]
    if label == "":  # Tabelle 2.5: Zeile "2nd" ohne Beschriftung
        return [idx + 1]
    raise ValueError(label)

tf = tables("research/out/rules/track-field-events-2026.txt")
rr = tables("research/out/rules/road-running-2026.txt")
xc = tables("research/out/rules/cross-country-2026.txt")

# (Quelle, Tabelle, placing_table, race_type)
spec = [
    (tf, "2.2", "TF", "F"),
    (tf, "2.3", "TF", "P9"),
    (tf, "2.4", "TF", "P10"),
    (tf, "2.5", "5000SC", "F"),
    (tf, "2.6", "5000SC", "P9"),
    (tf, "2.6", "5000SC", "P10"),
    (tf, "2.7", "5000SC", "P9"),
    (tf, "2.8", "5000SC", "P10"),
    (tf, "2.9", "10000", "F"),
    (tf, "2.10", "10KROAD", "F"),
    (rr, "4.1", "MARATHON", "F"),
    (rr, "4.2", "MARATHON_SIMILAR", "F"),
    (rr, "4.3", "ROAD", "F"),
    (xc, "6.1", "CROSS", "F"),
]
values = []
for src, num, table, race_type in spec:
    head, rows = src[num]
    for idx, row in enumerate(rows):
        places = place_of(row[0], idx)
        for cat, val in zip(head, row[1:]):
            if not val.replace("*", "").strip():
                continue
            pts = int(val.replace("*", "").strip())
            if table == "CROSS" and cat == "GW" and places == [25] and pts == 1001:
                pts = 1100  # Tippfehler in der WA-Tabelle (24. = 1105, 26. = 1098)
            for p in places:
                values.append(f"  ('{table}', '{cat}', '{race_type}', {p}, {pts})")

def q(v):
    return "null" if v == "" else "'" + v.replace("'", "''") + "'"

disc = []
for line in open("research/disciplines.txt", encoding="utf-8"):
    name, factor, group, tables, cross = line.rstrip("\n").split("|")
    arr = "'{" + tables + "}'"
    disc.append(f"  ({q(name)}, {factor}, {q(group)}, {arr}, {q(cross)})")

out = f"""-- =====================================================================
-- Fantasy Athletics – Referenzdaten (wird nach schema.sql eingespielt)
-- Automatisch erzeugt von research/build_placing_sql.py – nicht von Hand ändern.
--
-- disciplines: Disziplinfaktor (eigene Spielregel), Gruppe für die Aufstellungspositionen,
--   Platzierungstabellen und ggf. Cross-Tabelle. Bestehende Zeilen bleiben unverändert
--   (Faktoren lassen sich im Supabase Table Editor anpassen).
-- placing_scores: WA-World-Ranking-Regeln 2026 (Track & Field, Road Running, Cross Country),
--   werden bei jedem Einspielen aktualisiert.
-- =====================================================================

insert into disciplines (name, factor, event_group, placing_tables, cross_table) values
{",\n".join(disc)}
on conflict (name) do nothing;

insert into placing_scores (placing_table, category, race_type, place, points) values
{",\n".join(values)}
on conflict (placing_table, category, race_type, place) do update set points = excluded.points;
"""
open("supabase/reference_data.sql", "w", encoding="utf-8").write(out)
print(f"{len(disc)} Disziplinen, {len(values)} Platzierungswerte", file=sys.stderr)
