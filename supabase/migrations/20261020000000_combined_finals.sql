-- Finals mit mehreren Läufen (F1, F2, ...): Der Importer ermittelt aus den Detailergebnissen
-- die kombinierte Platzierung über alle Finalläufe und schreibt race = 'F' und place = kombinierter
-- Platz. Die Originalwerte von World Athletics bleiben in wa_race / wa_place erhalten und bilden
-- den stabilen Schlüssel für den Import.

alter table public.results add column wa_race text not null default '';
alter table public.results add column wa_place int;
update public.results set wa_race = race, wa_place = place;

alter table public.results drop constraint results_athlete_id_date_discipline_race_competition_key;
alter table public.results add constraint results_wa_key unique (athlete_id, date, discipline, wa_race, competition);

create or replace view public.result_points with (security_invoker = true) as
select
  r.id as result_id,
  s.id as season_id,
  r.athlete_id,
  r.date,
  r.competition,
  r.discipline,
  r.category,
  r.race,
  r.place,
  r.mark,
  r.result_score,
  coalesce(d.factor, 0) as discipline_factor,
  round(greatest(0, coalesce(r.result_score, 0) - s.perf_threshold) * s.perf_factor * coalesce(d.factor, 0), 1)
    as performance_points,
  round(coalesce(ps.points, 0) * s.placing_factor * coalesce(d.factor, 0), 1)
    as placing_points,
  round(greatest(0, coalesce(r.result_score, 0) - s.perf_threshold) * s.perf_factor * coalesce(d.factor, 0), 1)
    + round(coalesce(ps.points, 0) * s.placing_factor * coalesce(d.factor, 0), 1)
    as total_points,
  r.wa_race,
  r.wa_place
from public.results r
join public.seasons s on extract(year from r.date) = s.year
left join public.disciplines d on d.name = r.discipline
left join public.placing_scores ps
  on ps.placing_group = d.placing_group
 and ps.category = r.category
 and ps.race_type = public.race_type(r.race)
 and ps.place = r.place;
