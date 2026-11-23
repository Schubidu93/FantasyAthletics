# Offizielle WA-Punktetabellen (Scoring Tables of Athletics, PDF) → research/wa_scoring.txt
# Text kommt vom Ablauf „WA-Punktetabellen laden“ (Zweig probe-scoring-tables, research/out/scoring/tables.txt.gz):
#   git fetch origin probe-scoring-tables && git show FETCH_HEAD:research/out/scoring/tables.txt.gz | gunzip > /tmp/t.txt
#   python3 research/build_wa_scoring.py /tmp/t.txt && python3 research/build_placing_sql.py
# Je Disziplin und Geschlecht wird die Parabel Punkte = a·x² + b·x + c (x = Sekunden, Meter bzw. Punkte) an die Tabelle
# angepasst; gerundet trifft sie die Tabelle auf höchstens 1 Punkt genau (wird unten geprüft).
import re, sys, numpy as np
from collections import defaultdict
txt = open(sys.argv[1], encoding='utf-8').read().split('\n')
TOK = re.compile(r"4x400mix sh|4x400mix|4x\d+m sh|4x\d+m|\d+ Miles sh|\d+ Miles|Mile sh|Mile|\d+m SC|[\d,]+mW|\d+ ?km W|\d+ km|\d+mH|\d+m sh|\d+m|HMW|HM|MarW|Marathon|Hept\. sh|Pent\. sh|Hept\.|Dec\.|HJ|PV|LJ|TJ|SP|DT|HT|JT")
data = defaultdict(list); gender = None; section = ''; cols = None
for line in txt:
    line = line.lstrip('')
    m = re.match(r"\s*(WOMEN|MEN)[’']S (.*)", line, re.I)
    if m: gender = 'women' if m.group(1).upper() == 'WOMEN' else 'men'; section = m.group(2).upper(); cols = None; continue
    if line.strip().startswith('Points '):
        cols = TOK.findall(line.strip()[6:]); continue
    if cols is None: continue
    t = line.split()
    if len(t) == len(cols) + 1 and re.fullmatch(r'\d+', t[0]):
        p = int(t[0])
        for c, v in zip(cols, t[1:]):
            if v != '-':
                road = 'ROAD' in section and 'WALK' not in section
                data[(gender, ('road:' if road and c == 'Mile' else '') + c)].append((p, v))
def num(v):
    parts = v.split(':'); x = 0
    for q in parts: x = x * 60 + float(q)
    return x
out = {}
for k, rows in sorted(data.items()):
    P = np.array([r[0] for r in rows], float); X = np.array([num(r[1]) for r in rows])
    a, b, c = np.polyfit(X, P, 2)
    f = a * X**2 + b * X + c
    out[k] = (a, b, c, len(rows), float(np.mean(np.floor(f + 1e-9) == P)), float(np.mean(np.round(f) == P)), int(np.max(np.abs(np.round(f) - P))), X.min(), X.max())

NAMES = {  # unsere Disziplin (wie research/disciplines.txt) → Spalte in den WA-Tabellen
    '60 Metres': '60m', '100 Metres': '100m', '200 Metres': '200m', '200 Metres Short Track': '200m sh',
    '300 Metres': '300m', '300 Metres Short Track': '300m sh', '400 Metres': '400m', '400 Metres Short Track': '400m sh',
    '500 Metres Short Track': '500m sh', '600 Metres': '600m', '600 Metres Short Track': '600m sh',
    '800 Metres': '800m', '800 Metres Short Track': '800m sh', '1000 Metres': '1000m', '1000 Metres Short Track': '1000m sh',
    '1500 Metres': '1500m', '1500 Metres Short Track': '1500m sh', 'Mile': 'Mile', 'Mile Short Track': 'Mile sh',
    'Mile Road': 'road:Mile', '2000 Metres': '2000m', '2000 Metres Short Track': '2000m sh',
    '2000 Metres Steeplechase': '2000m SC', '3000 Metres': '3000m', '3000 Metres Short Track': '3000m sh',
    '2 Miles': '2 Miles', '2 Miles Short Track': '2 Miles sh', '3000 Metres Steeplechase': '3000m SC',
    '5000 Metres': '5000m', '5000 Metres Short Track': '5000m sh', '10,000 Metres': '10000m',
    '60 Metres Hurdles': '60mH', '100 Metres Hurdles': '100mH', '110 Metres Hurdles': '110mH',
    '300 Metres Hurdles': '300mH', '400 Metres Hurdles': '400mH',
    '5 Kilometres Road': '5 km', '10 Kilometres Road': '10 km', '15 Kilometres Road': '15 km', '10 Miles Road': '10 Miles',
    '20 Kilometres Road': '20 km', 'Half Marathon': 'HM', '25 Kilometres Road': '25 km', '30 Kilometres Road': '30 km',
    'Marathon': 'Marathon',
    '3000 Metres Race Walk Short Track': '3000mW', '5000 Metres Race Walk': '5000mW', '5000 Metres Race Walk Short Track': '5000mW',
    '10,000 Metres Race Walk': '10,000mW', '20,000 Metres Race Walk': '20,000mW', '10 Kilometres Race Walk': '10kmW',
    '20 Kilometres Race Walk': '20kmW', '35 Kilometres Race Walk': '35kmW', 'Half Marathon Race Walk': 'HMW',
    'Marathon Race Walk': 'MarW',
    'High Jump': 'HJ', 'Pole Vault': 'PV', 'Long Jump': 'LJ', 'Triple Jump': 'TJ',
    'Shot Put': 'SP', 'Discus Throw': 'DT', 'Hammer Throw': 'HT', 'Javelin Throw': 'JT',
    'Decathlon': 'Dec.', 'Heptathlon': 'Hept.', 'Heptathlon Short Track': 'Hept. sh', 'Pentathlon Short Track': 'Pent. sh',
    '4x100 Metres Relay': '4x100m', '4x200 Metres Relay Short Track': '4x200m sh', '4x400 Metres Relay': '4x400m',
    '4x400 Metres Relay Short Track': '4x400m sh', '4x400 Metres Relay Mixed': '4x400mix',
    '4x400 Metres Relay Mixed Short Track': '4x400mix sh',
}
norm = lambda c: c.replace(' W', 'W').replace('km W', 'kmW') if 'km' in c and c.endswith('W') else c
fits = {(g, norm(c)): v for (g, c), v in out.items()}
lines = []
for name, col in NAMES.items():
    for g in ('men', 'women'):
        v = fits.get((g, col))
        if v is None: continue                      # z. B. Zehnkampf nur Männer
        a, b, c, n, _, ok, err, lo, hi = v
        assert err <= 1, (name, g, err)
        lines.append(f"{name}|{g}|{float(a)!r}|{float(b)!r}|{float(c)!r}|{lo:g}|{hi:g}")
open('research/wa_scoring.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
print(len(lines), 'Zeilen → research/wa_scoring.txt')
