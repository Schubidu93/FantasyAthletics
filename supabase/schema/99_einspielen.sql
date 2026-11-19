-- Saisonwertungen beim Einspielen aufbauen (bzw. aktualisieren)
select refresh_season_stats(y) from generate_series(2025, extract(year from current_date)::int) y;

-- Einmalige Umstellungen der Live-Werte (nur in einer Datenbank mit Ergebnissen, jede genau einmal;
-- spätere Änderungen des Admins bleiben). Neue Datenbanken nutzen die Standardwerte.
create table if not exists schema_changes (name text primary key, applied_at timestamptz not null default now());
alter table schema_changes enable row level security;
do $$
begin
  if exists (select 1 from results) and not exists (select 1 from schema_changes where name = 'pool_950') then
    update scoring_config set pool_threshold = 950, updated_at = now() where pool_threshold = 1000;
    insert into schema_changes (name) values ('pool_950');
  end if;
  if exists (select 1 from results) and not exists (select 1 from schema_changes where name = 'placing_factor_0.2') then
    update scoring_config set placing_factor = 0.2, updated_at = now() where placing_factor = 0.1;
    insert into schema_changes (name) values ('placing_factor_0.2');
  end if;
  -- Alle Disziplinen: Pool ab 975 WA-Punkten; Athleten darunter, die keine Liga braucht, werden gelöscht
  if exists (select 1 from results) and not exists (select 1 from schema_changes where name = 'pool_975') then
    update scoring_config set pool_threshold = 975, updated_at = now() where pool_threshold = 950;
    perform refresh_pool();
    perform prune_athletes();
    insert into schema_changes (name) values ('pool_975');
  end if;
  -- Cross-Distanzfaktoren wie die Lauf-Faktoren angehoben (lauf_faktoren_2 in reference_data.sql)
  if not exists (select 1 from schema_changes where name = 'cross_faktoren_2') then
    update cross_distance_factors f set factor = x.factor
      from (values (6, 1.3, 1.5), (12, 1.6, 2), (1000, 2, 2.5)) x(max_km, old, factor)
     where f.max_km = x.max_km and f.factor = x.old;
    insert into schema_changes (name) values ('cross_faktoren_2');
  end if;
  -- „Neue Punkte“-Push startet ab jetzt: bisherige Punkte als schon gemeldet eintragen (kein Schwall beim Einführen)
  if not exists (select 1 from schema_changes where name = 'point_pushes_seed') then
    insert into point_pushes (manager_id, athlete_id, competition_id, label)
    select distinct x.manager_id, x.athlete_id, x.competition_id, x.label
      from leagues l cross join lateral _score_rows(l.id) x where l.status = 'active' and x.points > 0
    on conflict do nothing;
    insert into schema_changes (name) values ('point_pushes_seed');
  end if;
end $$;
