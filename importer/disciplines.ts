// Toplisten, aus denen der Athletenpool gebildet wird (DE, Senioren, alle Laufdisziplinen ab 800 m).
// `name` muss exakt dem WA-Disziplinnamen in den Ergebnissen entsprechen (siehe Tabelle `disciplines`).
export type ToplistDiscipline = { name: string; path: string };

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
];

export const COUNTRY = "ger";
