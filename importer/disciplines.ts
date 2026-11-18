// Toplisten, aus denen der Athletenpool gebildet wird (DE, Senioren): Lauf ab 800 m, Sprint, Hürden, Sprung, Wurf,
// Mehrkampf und Gehen. `name` muss exakt dem WA-Disziplinnamen in den Ergebnissen entsprechen (Tabelle `disciplines`).
// `genders`: nur für diese Geschlechter gibt es eine Liste (z. B. 110 m Hürden nur Männer).
import { parseMark } from "./placings";
import type { Gender } from "./wa";

export type ToplistDiscipline = { name: string; path: string; genders?: Gender[] };

export const TOPLIST_DISCIPLINES: ToplistDiscipline[] = [
  { name: "800 Metres", path: "middlelong/800-metres" },
  { name: "800 Metres Short Track", path: "middlelong/800-metres-short-track" },
  { name: "1000 Metres", path: "middlelong/1000-metres" },
  { name: "1000 Metres Short Track", path: "middlelong/1000-metres-short-track" },
  { name: "1500 Metres", path: "middlelong/1500-metres" },
  { name: "1500 Metres Short Track", path: "middlelong/1500-metres-short-track" },
  { name: "Mile", path: "middlelong/one-mile" },
  { name: "Mile Short Track", path: "middlelong/one-mile-short-track" },
  { name: "2000 Metres", path: "middlelong/2000-metres" },
  { name: "2000 Metres Short Track", path: "middlelong/2000-metres-short-track" },
  { name: "3000 Metres", path: "middlelong/3000-metres" },
  { name: "3000 Metres Short Track", path: "middlelong/3000-metres-short-track" },
  { name: "2 Miles", path: "middlelong/two-miles" },
  { name: "2 Miles Short Track", path: "middlelong/two-miles-short-track" },
  { name: "5000 Metres", path: "middlelong/5000-metres" },
  { name: "5000 Metres Short Track", path: "middlelong/5000-metres-short-track" },
  { name: "10,000 Metres", path: "middlelong/10000-metres" },
  { name: "2000 Metres Steeplechase", path: "middlelong/2000-metres-steeplechase" },
  { name: "3000 Metres Steeplechase", path: "middlelong/3000-metres-steeplechase" },
  { name: "Mile Road", path: "road-running/1-mile-road" },
  { name: "5 Kilometres Road", path: "road-running/5-kilometres" },
  { name: "10 Kilometres Road", path: "road-running/10-kilometres" },
  { name: "15 Kilometres Road", path: "road-running/15-kilometres" },
  { name: "10 Miles Road", path: "road-running/10-miles-road" },
  { name: "20 Kilometres Road", path: "road-running/20-kilometres" },
  { name: "Half Marathon", path: "road-running/half-marathon" },
  { name: "Marathon", path: "road-running/marathon" },
  { name: "60 Metres", path: "sprints/60-metres" },
  { name: "100 Metres", path: "sprints/100-metres" },
  { name: "200 Metres", path: "sprints/200-metres" },
  { name: "200 Metres Short Track", path: "sprints/200-metres-short-track" },
  { name: "400 Metres", path: "sprints/400-metres" },
  { name: "400 Metres Short Track", path: "sprints/400-metres-short-track" },
  { name: "60 Metres Hurdles", path: "hurdles/60-metres-hurdles" },
  { name: "100 Metres Hurdles", path: "hurdles/100-metres-hurdles", genders: ["W"] },
  { name: "110 Metres Hurdles", path: "hurdles/110-metres-hurdles", genders: ["M"] },
  { name: "400 Metres Hurdles", path: "hurdles/400-metres-hurdles" },
  { name: "High Jump", path: "jumps/high-jump" },
  { name: "Pole Vault", path: "jumps/pole-vault" },
  { name: "Long Jump", path: "jumps/long-jump" },
  { name: "Triple Jump", path: "jumps/triple-jump" },
  { name: "Shot Put", path: "throws/shot-put" },
  { name: "Discus Throw", path: "throws/discus-throw" },
  { name: "Hammer Throw", path: "throws/hammer-throw" },
  { name: "Javelin Throw", path: "throws/javelin-throw" },
  { name: "Decathlon", path: "combined-events/decathlon", genders: ["M"] },
  { name: "Heptathlon", path: "combined-events/heptathlon", genders: ["W"] },
  { name: "Heptathlon Short Track", path: "combined-events/heptathlon-short-track", genders: ["M"] },
  { name: "Pentathlon Short Track", path: "combined-events/pentathlon-short-track", genders: ["W"] },
  { name: "20 Kilometres Race Walk", path: "race-walks/20-kilometres-race-walk" },
  { name: "35 Kilometres Race Walk", path: "race-walks/35-kilometres-race-walk" },
];

/** Geschlechter mit eigener Liste für diese Disziplin. */
export const gendersOf = (d: ToplistDiscipline): Gender[] => d.genders ?? ["M", "W"];

/** Sprung, Wurf und Mehrkampf: mehr ist besser (wie `disciplines.higher_better` in der Datenbank). */
export const higherBetter = (discipline: string) => /Jump|Vault|Put|Throw|athlon/.test(discipline);

export const COUNTRY = "ger";


/** Vergleichswert einer Leistung: kleiner = besser (wie `_mark_cost` in der Datenbank). */
export function markCost(discipline: string, mark: string | null | undefined): number | null {
  const v = parseMark(mark);
  return v === null ? null : higherBetter(discipline) ? -v : v;
}
