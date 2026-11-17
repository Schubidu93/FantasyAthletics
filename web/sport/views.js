// Sportart Leichtathletik: eigene Seiten, Navigation und Laden der Athleten (von app.js eingebunden).
import { all, sb } from '../lib.js';
import { Riders } from './athletes.js';
import { Races } from './races.js';
import { Calendar } from './calendar.js';
import { Toplists } from './toplists.js';

/** Alle Athleten der Liga (Mixed: beide Geschlechter), sortiert nach Pool-Rang */
export const loadPeople = (league) => all(() => {
  const x = sb.from('athletes').select('*');
  return (league.gender === 'mixed' ? x : x.eq('gender', league.gender)).order('pool_rank', { nullsFirst: false }).order('id');
});

/** Bereiche der Navigation für Personen und Wettkämpfe */
export const SPORT_SECTIONS = [
  { key: 'people', route: 'athletes', label: 'Athleten', tabs: [['athletes', 'Athleten'], ['toplists', 'Toplisten']] },
  { key: 'races', label: 'Wettkämpfe', tabs: [['races', 'Ergebnisse'], ['calendar', 'Kalender']] },
];
export const SPORT_VIEWS = { athletes: Riders, races: Races, calendar: Calendar, toplists: Toplists };
export const PEOPLE_ICON = '<circle cx="15" cy="4.5" r="2"/><path d="M13.5 8.5 11 14M13.5 9l3 2.5 3-1M13.5 9 9.5 10.5 8 13.5M11 14l4 2.5-1 4.5h2M11 14l-2 4-4 .5"/>';

