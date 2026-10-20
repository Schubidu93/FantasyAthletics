-- Cross: Es gibt keine Zeitpunkte (WA-Punkte der Leistung). Gewertet werden nur
-- Platzierungspunkte aus der WA-Cross-Tabelle (Tab. 6.1), multipliziert mit einem eigenen
-- Faktor je Saison (cross_factor) und dem Disziplinfaktor.
--
-- Berg- und Traillauf: WA hat keine eigene Tabelle, wir nutzen die 10-km-Straßentabelle (Tab. 2.10).

alter table public.disciplines rename column performance_table to cross_table;
alter table public.seasons add column cross_factor numeric not null default 0.1;

update public.disciplines set placing_tables = '{10KROAD}'
where name ilike '%mountain%' or name ilike '%trail%' or name ilike '%uphill%';

create or replace view public.result_points with (security_invoker = true) as
with base as (
  select
    r.*,
    s.id as season_id,
    s.perf_threshold, s.perf_factor, s.placing_factor, s.cross_factor,
    coalesce(d.factor, 0) as discipline_factor,
    d.cross_table is not null as is_cross,
    (select ps.points from public.placing_scores ps
     where ps.placing_table = d.cross_table and ps.category = r.category
       and ps.race_type = 'F' and ps.place = r.place and public.race_type(r.race) = 'F') as cross_points,
    coalesce((
      select max(ps.points) from public.placing_scores ps
      where ps.placing_table = any (d.placing_tables)
        and ps.category = r.category
        and ps.race_type = coalesce(r.placing_round, public.race_type(r.race))
        and ps.place = coalesce(r.placing_place, r.place)
    ), 0) as placing_base
  from public.results r
  join public.seasons s on extract(year from r.date) = s.year
  left join public.disciplines d on d.name = r.discipline
),
pts as (
  select
    base.*,
    case when is_cross then 0
         else round(greatest(0, coalesce(result_score, 0) - perf_threshold) * perf_factor * discipline_factor, 1)
    end as perf_pts,
    case when is_cross then round(coalesce(cross_points, 0) * cross_factor * discipline_factor, 1)
         else round(placing_base * placing_factor * discipline_factor, 1)
    end as plc_pts
  from base
)
select
  id as result_id,
  season_id,
  athlete_id,
  date,
  competition,
  discipline,
  category,
  race,
  place,
  mark,
  result_score,
  discipline_factor,
  perf_pts as performance_points,
  plc_pts as placing_points,
  perf_pts + plc_pts as total_points,
  wa_race,
  wa_place,
  placing_round,
  placing_place
from pts;
