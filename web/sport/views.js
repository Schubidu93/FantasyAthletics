// Sportart Leichtathletik: eigene Seiten, Navigation und Laden der Athleten (von app.js eingebunden).
import { Riders } from './athletes.js';
import { Races } from './races.js';
import { Calendar } from './calendar.js';
import { Toplists } from './toplists.js';
import { TopResults } from './top.js';
import { all, sb } from '../lib.js';
import { fromLeagueCountry, groupArea, leagueAreas, riderGroup, withLeagueRanks } from './lib.js';

/** Athleten der Liga (Mixed: beide Geschlechter), sortiert nach Pool-Rang, mit Positions-Rang: nur mit Schwerpunkt-Disziplin in den
 *  Bereichen der Liga – dazu alle, die in der Liga je in einem Kader standen (auch wenn sich ihr Schwerpunkt geändert hat) */
// Athleten nach IDs, in Blöcken (lange ID-Listen sprengen sonst die Adresse der Abfrage)
async function loadByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...await all(() => sb.from('athletes').select('*').in('id', ids.slice(i, i + 150)).order('id')));
  return out;
}

export async function loadPeople(league) {
  // aus der Datenbank nur Athleten aus dem Land der Liga, von Hand hinzugefügte und alle, die je im Kader der Liga standen
  const base = () => {
    const x = sb.from('athletes').select('*');
    return league.gender === 'mixed' ? x : x.eq('gender', league.gender);
  };
  const rostered = (await all(() => sb.from('roster_entries').select('athlete_id').eq('league_id', league.id).order('id'))).map((r) => r.athlete_id);
  const [own, manual, former] = await Promise.all([
    all(() => base().eq('nation', league.nation || 'GER').order('pool_rank', { nullsFirst: false }).order('id')),
    all(() => base().eq('manual', true).order('id')),
    loadByIds([...new Set(rostered)]),
  ]);
  const byId = new Map([...own, ...manual, ...former].map((r) => [r.id, r]));
  const keep = new Set(rostered);
  const areas = leagueAreas(league);
  const people = [...byId.values()].sort((a, b) => (a.pool_rank ?? 1e9) - (b.pool_rank ?? 1e9) || a.id.localeCompare(b.id));
  return withLeagueRanks(people.filter((r) => keep.has(r.id)
    || (fromLeagueCountry(r, league) && (!groupArea(riderGroup(r)) || areas.includes(groupArea(riderGroup(r)))))), league);
}

/** Bereiche der Navigation für Personen und Wettkämpfe */
export const SPORT_SECTIONS = [
  { key: 'people', route: 'athletes', label: 'Athleten', tabs: [['athletes', 'Athleten'], ['toplists', 'Toplisten']] },
  { key: 'races', label: 'Wettkämpfe', tabs: [['races', 'Ergebnisse'], ['top', 'Top-Leistungen'], ['calendar', 'Kalender']] },
];
export const SPORT_VIEWS = { athletes: Riders, races: Races, top: TopResults, calendar: Calendar, toplists: Toplists };
export const PEOPLE_ICON = '<circle cx="15" cy="4.5" r="2"/><path d="M13.5 8.5 11 14M13.5 9l3 2.5 3-1M13.5 9 9.5 10.5 8 13.5M11 14l4 2.5-1 4.5h2M11 14l-2 4-4 .5"/>';

