// Erkundung: Wie viele deutsche Athleten gibt es je Disziplin über 950 bzw. 975 WA-Punkten (aktuelles Jahr + Vorjahr)?
// Grundlage für die Erweiterung auf alle Disziplinen. Prüft auch, ob die Toplisten-Pfade bei WA stimmen.
// Ergebnis: research/out/toplists/summary.txt (+ Konsole)
import { mkdirSync, writeFileSync } from "node:fs";
import { TOPLIST_DISCIPLINES } from "../importer/disciplines";
import { fetchToplist, sleep, type Gender } from "../importer/wa";

const OUT = "research/out/toplists";
mkdirSync(OUT, { recursive: true });
const lines: string[] = [];
const say = (s: string) => { console.log(s); lines.push(s); };

// Kandidaten für die neuen Disziplinen (Pfad wie in der URL der WA-Toplisten)
const NEW: { name: string; path: string; group: string }[] = [
  { name: "60 Metres", path: "sprints/60-metres", group: "Sprint" },
  { name: "100 Metres", path: "sprints/100-metres", group: "Sprint" },
  { name: "200 Metres", path: "sprints/200-metres", group: "Sprint" },
  { name: "200 Metres Short Track", path: "sprints/200-metres-short-track", group: "Sprint" },
  { name: "400 Metres", path: "sprints/400-metres", group: "Sprint" },
  { name: "400 Metres Short Track", path: "sprints/400-metres-short-track", group: "Sprint" },
  { name: "60 Metres Hurdles", path: "hurdles/60-metres-hurdles", group: "Hürden" },
  { name: "100 Metres Hurdles", path: "hurdles/100-metres-hurdles", group: "Hürden" },
  { name: "110 Metres Hurdles", path: "hurdles/110-metres-hurdles", group: "Hürden" },
  { name: "400 Metres Hurdles", path: "hurdles/400-metres-hurdles", group: "Hürden" },
  { name: "High Jump", path: "jumps/high-jump", group: "Sprung" },
  { name: "Pole Vault", path: "jumps/pole-vault", group: "Sprung" },
  { name: "Long Jump", path: "jumps/long-jump", group: "Sprung" },
  { name: "Triple Jump", path: "jumps/triple-jump", group: "Sprung" },
  { name: "Shot Put", path: "throws/shot-put", group: "Wurf" },
  { name: "Discus Throw", path: "throws/discus-throw", group: "Wurf" },
  { name: "Hammer Throw", path: "throws/hammer-throw", group: "Wurf" },
  { name: "Javelin Throw", path: "throws/javelin-throw", group: "Wurf" },
  { name: "Decathlon", path: "combined-events/decathlon", group: "Mehrkampf" },
  { name: "Heptathlon", path: "combined-events/heptathlon", group: "Mehrkampf" },
  { name: "Heptathlon Short Track", path: "combined-events/heptathlon-short-track", group: "Mehrkampf" },
  { name: "Pentathlon Short Track", path: "combined-events/pentathlon-short-track", group: "Mehrkampf" },
  { name: "20 Kilometres Race Walk", path: "race-walks/20-kilometres-race-walk", group: "Gehen" },
  { name: "35 Kilometres Race Walk", path: "race-walks/35-kilometres-race-walk", group: "Gehen" },
];
const ALL = [...TOPLIST_DISCIPLINES.map((d) => ({ ...d, group: "Lauf (bisher)" })), ...NEW];

const year = new Date().getUTCMonth() >= 10 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear();
const years = [year - 1, year - 2].filter((y) => y >= 2025);   // Spieljahr 2027 → Toplisten 2026 und 2025
const best = new Map<string, { group: string; score: number; gender: Gender }>();   // Athlet → beste Punktzahl
const byGroup = new Map<string, { a950: Set<number>; a975: Set<number> }>();

say(`Toplisten DE, Jahre ${years.join(", ")}, Schwellen 950 / 975`);
say("Disziplin | Geschlecht | Jahr | ≥950 | ≥975 | beste Leistung");
for (const d of ALL) {
  for (const gender of ["M", "W"] as Gender[]) {
    for (const y of years) {
      try {
        const rows = await fetchToplist(d.path, gender, y, "ger", 950, 10);
        const n975 = rows.filter((r) => r.score >= 975);
        const g = byGroup.get(d.group) ?? { a950: new Set(), a975: new Set() };
        rows.forEach((r) => g.a950.add(r.athleteId));
        n975.forEach((r) => g.a975.add(r.athleteId));
        byGroup.set(d.group, g);
        for (const r of rows) {
          const b = best.get(String(r.athleteId));
          if (!b || b.score < r.score) best.set(String(r.athleteId), { group: d.group, score: r.score, gender });
        }
        if (rows.length) say(`${d.name} | ${gender} | ${y} | ${rows.length} | ${n975.length} | ${rows[0].mark} (${rows[0].score})`);
      } catch (e) {
        say(`${d.name} | ${gender} | ${y} | FEHLER ${(e as Error).message.slice(0, 120)}`);
      }
      await sleep(400);
    }
  }
}
say("");
say("Athleten je Gruppe (verschiedene Personen) | ≥950 | ≥975");
for (const [g, s] of byGroup) say(`${g} | ${s.a950.size} | ${s.a975.size}`);
const all950 = new Set([...byGroup.values()].flatMap((s) => [...s.a950]));
const all975 = new Set([...byGroup.values()].flatMap((s) => [...s.a975]));
say(`Gesamt (alle Disziplinen) | ${all950.size} | ${all975.size}`);
const run975 = byGroup.get("Lauf (bisher)")?.a975.size ?? 0;
say(`Davon Lauf bisher ≥975: ${run975}; neu dazu ≥975: ${all975.size - run975}`);
writeFileSync(`${OUT}/summary.txt`, lines.join("\n") + "\n");
