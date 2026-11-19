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
ce = tables("research/out/rules/combined-events-2026.txt")
rw = tables("research/out/rules/race-walking-2026.txt")

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
    (ce, "3.1", "CE", "F"),
    (rw, "5.1", "RW_HM", "F"),
    (rw, "5.2", "RW_MAR", "F"),
    (rw, "5.3", "RW_LONG", "F"),
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
    name, factor, group, tables, cross, higher = line.rstrip("\n").split("|")
    arr = "'{" + tables + "}'"
    disc.append(f"  ({q(name)}, {factor}, {q(group)}, {arr}, {q(cross)}, {'true' if higher else 'false'})")
# Disziplinen, die mit der Erweiterung auf alle Disziplinen erstmals zählen (vorher Faktor 0): einmalig umstellen
COMBINED = ["Decathlon", "Heptathlon", "Heptathlon Short Track", "Pentathlon Short Track"]
FIELD = ["High Jump", "Pole Vault", "Long Jump", "Triple Jump", "Hammer Throw", "Javelin Throw"]
# Faktor neu → alt (Migration lauf_faktoren_2)
RUN_UP = {"1.5": "1.3", "2": "1.6", "2.5": "2", "4": "3"}
RUN_GROUPS = {"800", "1500", "5000", "10000", "Marathon", "Hindernis", "Gehen"}
RUN_ROWS = [(f[0], f[1], RUN_UP[f[1]]) for f in (l.split("|") for l in open("research/disciplines.txt", encoding="utf-8"))
            if f[2] in RUN_GROUPS and f[1] in RUN_UP]
WALKS = ["3000 Metres Race Walk Short Track", "5000 Metres Race Walk", "10 Kilometres Race Walk", "20 Kilometres Race Walk",
         "20,000 Metres Race Walk", "Half Marathon Race Walk", "35 Kilometres Race Walk", "Marathon Race Walk"]
newly_scored = [n for n in (l.split("|")[0] for l in open("research/disciplines.txt", encoding="utf-8"))
                if "Race Walk" in n or n in ("4x100 Metres Relay", "4x200 Metres Relay Short Track")]

out = f"""-- =====================================================================
-- Fantasy Athletics – Referenzdaten (wird nach supabase/schema/ eingespielt)
-- Automatisch erzeugt von research/build_placing_sql.py – nicht von Hand ändern.
--
-- disciplines: Disziplinfaktor (eigene Spielregel), Gruppe für die Aufstellungspositionen, Platzierungstabellen,
--   ggf. Cross-Tabelle und Wertungsrichtung (higher_better: Sprung, Wurf, Mehrkampf). Gruppe, Tabellen und Richtung
--   werden bei jedem Einspielen aktualisiert, der Faktor nicht (lässt sich im Admin-Bereich anpassen).
-- placing_scores: WA-World-Ranking-Regeln 2026 (Track & Field, Road Running, Cross Country, Combined Events,
--   Race Walking), werden bei jedem Einspielen aktualisiert.
-- =====================================================================

insert into disciplines (name, factor, event_group, placing_tables, cross_table, higher_better) values
{",\n".join(disc)}
on conflict (name) do update set event_group = excluded.event_group, placing_tables = excluded.placing_tables,
  cross_table = excluded.cross_table, higher_better = excluded.higher_better;

-- einmalig: Gehen und Sprintstaffeln zählen jetzt (in Ligen, die diese Bereiche spielen)
do $$
begin
  if not exists (select 1 from schema_changes where name = 'alle_disziplinen_faktoren') then
    update disciplines d set factor = x.factor from (values
{",\n".join(f"      ({q(n)}, {f})" for n, f in ((l.split("|")[0], l.split("|")[1]) for l in open("research/disciplines.txt", encoding="utf-8")) if n in newly_scored)}
    ) x(name, factor) where d.name = x.name and d.factor = 0;
    insert into schema_changes (name) values ('alle_disziplinen_faktoren');
  end if;
end $$;

-- einmalig: Mehrkampf zählt mehr (wenige Wettkämpfe im Jahr, zwei Tage): Zehn-/Siebenkampf ×4, Halle ×3
do $$
begin
  if not exists (select 1 from schema_changes where name = 'mehrkampf_faktoren') then
    update disciplines d set factor = x.factor from (values
{",\n".join(f"      ({q(n)}, {f})" for n, f in ((l.split("|")[0], l.split("|")[1]) for l in open("research/disciplines.txt", encoding="utf-8")) if n in COMBINED)}
    ) x(name, factor) where d.name = x.name and d.factor = 1;
    insert into schema_changes (name) values ('mehrkampf_faktoren');
  end if;
end $$;

-- einmalig: Gehen mit denselben Faktoren wie der Lauf über die gleiche Strecke (5000 m 1,3 · 10 km 1,6 · 20 km 2 · 35 km/Marathon 3)
do $$
begin
  if not exists (select 1 from schema_changes where name = 'gehen_faktoren') then
    update disciplines d set factor = x.factor from (values
{",\n".join(f"      ({q(n)}, {f})" for n, f in ((l.split("|")[0], l.split("|")[1]) for l in open("research/disciplines.txt", encoding="utf-8")) if n in WALKS)}
    ) x(name, factor) where d.name = x.name and d.factor = 1;
    insert into schema_changes (name) values ('gehen_faktoren');
  end if;
end $$;

-- einmalig: Sprung ×1,3, Hammer und Speer ×1,5 – weniger Wettkämpfe im Jahr (Auswertung 2025: Top-10 je Schwerpunkt
-- 130–200 Punkte gegenüber 230–330 in den anderen Bereichen, nachdem je Wettkampf nur die beste Runde zählt)
do $$
begin
  if not exists (select 1 from schema_changes where name = 'feld_faktoren') then
    update disciplines d set factor = x.factor from (values
{",\n".join(f"      ({q(n)}, {f})" for n, f in ((l.split("|")[0], l.split("|")[1]) for l in open("research/disciplines.txt", encoding="utf-8")) if n in FIELD)}
    ) x(name, factor) where d.name = x.name and d.factor = 1;
    insert into schema_changes (name) values ('feld_faktoren');
  end if;
end $$;

-- einmalig: Lauf und Gehen über längere Strecken höher (Marathon ×4 wie Zehnkampf; 5000 m/Hindernis 1,5, 10.000 m 2,
-- Halbmarathon 2,5) – lange Strecken laufen nur wenige Rennen im Jahr
do $$
begin
  if not exists (select 1 from schema_changes where name = 'lauf_faktoren_2') then
    update disciplines d set factor = x.factor from (values
{",\n".join(f"      ({q(n)}, {f}, {o})" for n, f, o in RUN_ROWS)}
    ) x(name, factor, old) where d.name = x.name and d.factor = x.old;
    insert into schema_changes (name) values ('lauf_faktoren_2');
  end if;
end $$;

insert into placing_scores (placing_table, category, race_type, place, points) values
{",\n".join(values)}
on conflict (placing_table, category, race_type, place) do update set points = excluded.points;
"""
open("supabase/reference_data.sql", "w", encoding="utf-8").write(out)
print(f"{len(disc)} Disziplinen, {len(values)} Platzierungswerte", file=sys.stderr)
