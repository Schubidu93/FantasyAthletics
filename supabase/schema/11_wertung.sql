-- =====================================================================
-- Wertung: Pool und Punkte aus den World-Athletics-Daten
-- =====================================================================

-- Gewerteter Lauf: nur Finals ('' oder 'F') bekommen Platzierungspunkte nach Platz;
-- Vorrunden werden vom Importer über placing_round/placing_place gewertet.
create or replace function _race_type(p_race text) returns text
language sql immutable as $$
  select case when p_race is null or p_race in ('', 'F') then 'F' end;
$$;

-- Toplisten eines Athleten mit Platz in der DE-Topliste (je Jahr, Disziplin und Geschlecht; gleiche Punkte = gleicher Platz).
-- Gespeichert sind alle Einträge ab der Pool-Schwelle, also auch alle, die vor dem Athleten liegen.
-- Platz nach der Leistung (wie die WA-Topliste), nicht nach WA-Punkten (Hallenzeiten haben mehr Punkte)
create or replace function athlete_toplists(p_athlete text)
returns table (year int, discipline text, mark text, score int, rank int)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select t.year, t.discipline, t.mark, t.score,
         (select count(*) + 1 from toplist_entries o join athletes oa on oa.id = o.athlete_id
           where o.year = t.year and o.discipline = t.discipline and oa.gender = a.gender
             and _mark_cost(t.discipline, o.mark) < _mark_cost(t.discipline, t.mark))::int
    from toplist_entries t join athletes a on a.id = t.athlete_id
   where t.athlete_id = p_athlete
   order by t.year desc, t.score desc;
end $$;

-- Toplisten-Ansicht: vorhandene Jahre/Disziplinen/Geschlechter und die besten Einträge einer Liste
-- Land eines Athleten passt zur Liga (null = alle Länder; auch von Hand hinzugefügte nur im eigenen Land) – wie _eligible/fromLeagueCountry
create or replace function _nation_ok(p_nation text, a athletes) returns boolean
language sql immutable as $$
  select p_nation is null or coalesce(a.nation, 'GER') = p_nation;
$$;

-- Toplisten je Land (Land des Athleten laut WA-Profil, wie die Liga: leagues.nation)
drop function if exists toplist_index();
create or replace function toplist_index(p_nation text default 'GER')
returns table (year int, discipline text, gender text, entries int)
language sql stable security definer set search_path = public as $$
  select t.year, t.discipline, a.gender, count(*)::int
    from toplist_entries t join athletes a on a.id = t.athlete_id
   where coalesce(a.nation, 'GER') = p_nation
   group by 1, 2, 3 order by 1 desc, 2, 3;
$$;
drop function if exists toplist(int, text, text, int);
create or replace function toplist(p_year int, p_discipline text, p_gender text, p_limit int default 20, p_nation text default 'GER')
returns table (rank int, athlete_id text, name text, nation text, mark text, score int)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  select (rank() over (order by _mark_cost(p_discipline, t.mark) nulls last))::int, t.athlete_id, a.name, a.nation, t.mark, t.score
    from toplist_entries t join athletes a on a.id = t.athlete_id
   where t.year = p_year and t.discipline = p_discipline and a.gender = p_gender and coalesce(a.nation, 'GER') = p_nation
   order by _mark_cost(p_discipline, t.mark) nulls last, a.name limit least(coalesce(p_limit, 20), 200);
end $$;

-- Wettkämpfe → Ergebnisse: welche Disziplinen es je Wettkampf gab (für den Disziplin-Filter)
drop function if exists competition_disciplines();
drop function if exists competition_disciplines(text);
-- je Wettkampf die Disziplinen (gesamt, Männer, Frauen) – nur Ergebnisse von Athleten des Landes (p_nation null = alle);
-- Wettkämpfe ohne Ergebnis aus dem Land fehlen ganz (die App blendet sie aus). Nachträge über Name und Datum.
create or replace function competition_disciplines(p_nation text default null)
returns table (competition_id text, disciplines text[], men text[], women text[])
language sql stable security definer set search_path = public as $$
  with r as (
    select 'wa-c' || w.wa_competition_id cid, w.discipline, a.gender
      from wa_results w join athletes a on a.id = w.athlete_id
     where w.wa_competition_id is not null and _nation_ok(p_nation, a)
    union all
    select c.id, w.discipline, a.gender
      from wa_results w join athletes a on a.id = w.athlete_id
      join competitions c on c.id !~ '^wa-c' and c.name = w.competition and w.date between c.start_date and coalesce(c.end_date, c.start_date)
     where w.source = 'manual' and _nation_ok(p_nation, a))
  select cid, array_agg(distinct discipline order by discipline),
         coalesce(array_agg(distinct discipline order by discipline) filter (where gender = 'men'), '{}'),
         coalesce(array_agg(distinct discipline order by discipline) filter (where gender = 'women'), '{}')
    from r group by cid order by cid;
$$;

-- Ergebnisse eines Wettkampfs (WA über die Wettkampf-ID, Nachträge über Name und Datum) mit Fantasy-Punkten,
-- nur von Athleten des Landes (p_nation null = alle)
drop function if exists competition_results(text, text);   -- Rückgabe um wind/not_legal erweitert
create or replace function competition_results(p_competition text, p_nation text default null)
returns table (id bigint, athlete_id text, date date, competition text, discipline text, category text, race text, place int,
               wa_race text, wa_place int, placing_round text, placing_place int, mark text, result_score int, remark text,
               wa_event_id bigint, champ_place int, source_url text, pts numeric, wind text, not_legal boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.athlete_id, w.date, w.competition, w.discipline, w.category, w.race, w.place, w.wa_race, w.wa_place,
         w.placing_round, w.placing_place, w.mark, w.result_score, w.remark, w.wa_event_id, w.champ_place, w.source_url,
         (select r.points from results r where r.wa_result_id = w.id limit 1), w.wind, w.not_legal
    from wa_results w join athletes a on a.id = w.athlete_id, competitions c
   where c.id = p_competition and _nation_ok(p_nation, a)
     and (case when c.id ~ '^wa-c' then w.wa_competition_id = substr(c.id, 5)::bigint
               else w.source = 'manual' and w.competition = c.name and w.date between c.start_date and coalesce(c.end_date, c.start_date) end)
   order by w.date, w.id;
$$;

-- Spieljahr: die Saison, für die gerade gedraftet bzw. gespielt wird. Ab 1. November zählt das Folgejahr
-- (Draft für die neue Saison); von Hand festlegbar über scoring_config.game_year.
create or replace function game_year() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select game_year from scoring_config where id = 1),
                  extract(year from current_date)::int + case when extract(month from current_date) >= 11 then 1 else 0 end);
$$;

-- Pool neu bilden. Pool = mindestens pool_threshold WA-Punkte in der DE-Topliste (Jahr p_year oder Vorjahr).
-- Disziplingruppe und Pool-Rang richten sich nach dem Bezugsjahr = Vorjahr des Spieljahrs (Saison 2027 → 2026):
--   1. Gruppe mit den meisten Fantasy-Punkten im Bezugsjahr (Cross nach Distanz, siehe _result_group)
--   2. Punkte im Bezugsjahr, aber 0 Punkte: Gruppe der höchsten WA-Leistung im Bezugsjahr
--   3. keine Ergebnisse im Bezugsjahr (neu): erste Leistung im Spieljahr ab new_group_threshold WA-Punkten
--   4. sonst: Gruppe der besten Toplistenleistung
--   group_override (vom Admin) hat immer Vorrang. pool_rank = nach Punkten im Bezugsjahr, dann bester Toplistenleistung.
create or replace function refresh_pool(p_year int default null) returns int
language plpgsql security definer set search_path = public as $$
declare y int := coalesce(p_year, extract(year from current_date)::int); c scoring_config; n int;
        gy int := game_year(); ref int := game_year() - 1;
begin
  select * into c from scoring_config where id = 1;
  update athletes set ranking_points = null, pool_rank = null, group_points = null, group_basis = null
   where ranking_points is not null or pool_rank is not null or group_points is not null;
  -- 4. beste Toplistenleistung (Bestleistung, Pool-Zugehörigkeit, Gruppe als Rückfall)
  update athletes r set ranking_points = b.score, best_discipline = b.discipline, best_mark = b.mark,
                      best_year = b.year, event_group = b.event_group, group_basis = 'toplist', updated_at = now()
    from (select distinct on (t.athlete_id) t.athlete_id, t.discipline, t.mark, t.score, t.year, d.event_group
            from toplist_entries t join disciplines d on d.name = t.discipline
           where t.year in (y, y - 1) and d.event_group is not null
           order by t.athlete_id, t.score desc, t.year desc) b
   where b.athlete_id = r.id;
  -- von Hand hinzugefügte Athleten ohne Toplisteneintrag: beste WA-Leistung der letzten zwei Jahre
  update athletes r set ranking_points = b.score, best_discipline = b.discipline, best_mark = b.mark,
                      best_year = b.yr, event_group = coalesce(r.event_group, b.g), group_basis = coalesce(r.group_basis, 'best')
    from (select distinct on (w.athlete_id) w.athlete_id, w.discipline, w.mark, w.result_score score,
                 extract(year from w.date)::int as yr, _result_group(w.discipline, w.competition) g
            from wa_results w join athletes a on a.id = w.athlete_id
           where a.manual and extract(year from w.date) in (y, y - 1) and w.result_score > 0 and not w.not_legal
             and _result_group(w.discipline, w.competition) is not null
           order by w.athlete_id, w.result_score desc) b
   where b.athlete_id = r.id and r.ranking_points is null;
  -- 3. neue Athleten: erste gute Leistung im Spieljahr
  update athletes a set event_group = f.g, group_basis = 'first'
    from (select distinct on (w.athlete_id) w.athlete_id, _result_group(w.discipline, w.competition) g
            from wa_results w
           where extract(year from w.date) = gy and w.result_score >= c.new_group_threshold
             and _result_group(w.discipline, w.competition) is not null
           order by w.athlete_id, w.date, w.result_score desc) f
   where f.athlete_id = a.id
     and not exists (select 1 from wa_results o where o.athlete_id = a.id and extract(year from o.date) = ref);
  -- 2. Ergebnisse im Bezugsjahr, aber keine Punkte: höchste WA-Leistung
  update athletes a set event_group = h.g, group_points = 0, group_basis = 'best'
    from (select distinct on (w.athlete_id) w.athlete_id, _result_group(w.discipline, w.competition) g
            from wa_results w
           where extract(year from w.date) = ref and w.result_score > 0 and _result_group(w.discipline, w.competition) is not null
           order by w.athlete_id, w.result_score desc, w.date desc) h
   where h.athlete_id = a.id;
  -- 1. meiste Fantasy-Punkte im Bezugsjahr (bei Gleichstand die höhere Einzelleistung)
  update athletes a set event_group = p.g, group_points = p.total, group_basis = 'points'
    from (select distinct on (athlete_id) athlete_id, g, sum(pts) over (partition by athlete_id) total
            from (select r.athlete_id, _result_group(w.discipline, w.competition) g, sum(r.points) pts, max(w.result_score) best
                    from results r join wa_results w on w.id = r.wa_result_id
                   where extract(year from r.result_date) = ref
                   group by 1, 2) x
           where g is not null
           order by athlete_id, pts desc, best desc nulls last) p
   where p.athlete_id = a.id and p.total > 0;
  -- Pool: Athleten der Länder aus pool_nations ab der Schwelle des Landes, dazu von Hand hinzugefügte
  update athletes r set pool_rank = x.rk
    from (select a.id, row_number() over (order by coalesce(a.group_points, 0) desc, a.ranking_points desc nulls last, a.name) rk
            from athletes a left join pool_nations n on n.code = coalesce(a.nation, 'GER')
           where (n.code is not null and a.ranking_points >= coalesce(n.threshold, c.pool_threshold)) or a.manual) x
   where x.id = r.id;
  get diagnostics n = row_count;
  -- beste Leistung der letzten 12 Monate (nach WA-Punkten; ohne Staffeln, Zwischenzeiten, Mehrkampf-Einzeldisziplinen)
  update athletes a set recent_discipline = b.discipline, recent_mark = b.mark, recent_score = b.result_score
    from (select a2.id, w.discipline, w.mark, w.result_score
            from athletes a2
            left join lateral (select w.discipline, w.mark, w.result_score from wa_results w
                                where w.athlete_id = a2.id and w.date > current_date - 365 and w.result_score > 0
                                  and w.relay is null and not _is_relay(w.discipline) and w.wa_race not like 'CE%'
                                  and not _is_split(w.competition, w.remark) and not w.not_legal   -- Rückenwind zählt nicht als Bestwert
                                order by w.result_score desc, w.date desc limit 1) w on true) b
   where b.id = a.id and (a.recent_mark, a.recent_score, a.recent_discipline) is distinct from (b.mark, b.result_score, b.discipline);
  -- wer für ein anderes Land startet, verschwindet ganz (außer er wird in einer Liga verwendet)
  perform prune_athletes(true);
  return n;
end $$;

-- Athleten außerhalb des Pools löschen, die keine Liga braucht (nicht manuell hinzugefügt, in keinem Kader, Draft, Waiver,
-- Tausch, keiner Aufstellung und keinem eingefrorenen Spieltag). „Gebraucht“ = jede Tabelle, die per Fremdschlüssel ohne
-- „on delete cascade“ auf athletes zeigt (neue Tabellen zählen automatisch mit), dazu score_snapshot.
-- Ergebnisse, Bestleistungen und Toplisteneinträge der gelöschten Athleten fallen mit weg.
-- Athleten außerhalb des Pools löschen, solange sie nirgends verwendet werden (Kader, Draft, Tausch …);
-- p_foreign_only: nur die, die laut WA für ein anderes Land starten (läuft bei jedem refresh_pool)
drop function if exists prune_athletes();
create or replace function prune_athletes(p_foreign_only boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare cond text := ' and not exists (select 1 from score_snapshot x where x.athlete_id = a.id)'; r record; n int;
begin
  if p_foreign_only then cond := cond || ' and coalesce(a.nation, ''GER'') not in (select code from pool_nations)'; end if;
  for r in select c.conrelid::regclass tbl, att.attname col
             from pg_constraint c join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
            where c.contype = 'f' and c.confrelid = 'athletes'::regclass and c.confdeltype <> 'c' loop
    cond := cond || format(' and not exists (select 1 from %s x where x.%I = a.id)', r.tbl, r.col);
  end loop;
  execute 'delete from athletes a where a.pool_rank is null and not a.manual' || cond;
  get diagnostics n = row_count;
  -- Wettkämpfe ohne Ergebnis mehr (z. B. nur Athleten, die gerade gelöscht wurden) verschwinden aus der Liste
  delete from competitions c
   where c.id like 'wa-c%' and not exists (select 1 from results res where res.competition_id = c.id)
     and c.id not in (select 'wa-c' || w.wa_competition_id from wa_results w where w.wa_competition_id is not null);
  return n;
end $$;

-- Cross: Distanz steht nur im Wettkampfnamen, z. B. "Sparkassen Cross Pforzheim, Pforzheim - XC 7.5km"
create or replace function cross_km(p_competition text) returns numeric
language sql immutable as $$
  select replace((regexp_match(coalesce(p_competition, ''), 'XC\s*([0-9]+(?:[.,][0-9]+)?)\s*km', 'i'))[1], ',', '.')::numeric;
$$;

-- Disziplinfaktor für Cross nach Distanz (analog Bahn/Straße): bis max_km gilt factor.
-- Ohne Distanzangabe gilt der Faktor aus disciplines. Anpassbar im Supabase Table Editor.
create table if not exists cross_distance_factors (
  max_km numeric primary key,
  factor numeric not null check (factor >= 0),
  label  text
);
insert into cross_distance_factors (max_km, factor, label) values
  (3, 1, 'bis 3 km – wie 1500 m'),
  (6, 1.5, 'über 3 bis 6 km – wie 3000/5000 m'),
  (12, 2, 'über 6 bis 12 km – wie 10.000 m'),
  (1000, 2.5, 'über 12 km – wie Halbmarathon/25 km Straße')
on conflict (max_km) do nothing;

create or replace function _cross_factor(p_km numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select factor from cross_distance_factors where p_km is not null and p_km <= max_km order by max_km limit 1;
$$;

-- Disziplingruppe eines Ergebnisses: aus disciplines; Cross nach Distanz im Wettkampfnamen
-- (bis 3 km → 1500, bis 6 km → 5000, bis 12 km → 10000, darüber → Marathon, ohne Angabe → 10000)
create or replace function _result_group(p_discipline text, p_competition text) returns text
language sql stable security definer set search_path = public as $$
  select case when d.cross_table is not null then
                case when cross_km(p_competition) is null then '10000'
                     when cross_km(p_competition) <= 3 then '1500'
                     when cross_km(p_competition) <= 6 then '5000'
                     when cross_km(p_competition) <= 12 then '10000'
                     else 'Marathon' end
              else d.event_group end
    from disciplines d where d.name = p_discipline;
$$;

-- Punkte je Ergebnis (in results) aus den WA-Rohdaten neu berechnen:
--   Leistung   = max(0, WA-Punkte − perf_threshold) × perf_factor × Disziplinfaktor
--   Platzierung = WA-Platzierungspunkte (bester Wert der Tabellen der Disziplin) × placing_factor × Disziplinfaktor
--   Cross: WA vergibt dort nur einen Wert je Platz (Tab. 6.1, wie WA-Punkte); gewertet wird wie eine Leistung:
--          max(0, Cross-Tabellenwert − perf_threshold) × cross_factor × Distanzfaktor (cross_distance_factors),
--          keine Platzierungspunkte
-- Gespeichert werden nur Ergebnisse mit Punkten. Eingefrorene Spieltage sind davon nicht betroffen.
-- Zwischenzeit: WA führt sie als eigenen Wettkampf „… - Split times“ bzw. mit Vermerk ST
create or replace function _is_split(p_competition text, p_remark text) returns boolean
language sql immutable as $$
  select coalesce(p_competition, '') ~* 'split time' or coalesce(p_remark, '') = 'ST';
$$;

-- Staffel laut Disziplin (z. B. „4x100 Metres Relay“, „Distance Medley“): keine Bestleistungen
create or replace function _is_relay(p_discipline text) returns boolean
language sql immutable as $$
  select coalesce(p_discipline, '') ~* '(relay|medley)';
$$;

-- Persönliche Bestleistung je Ergebnis (wa_results.id → Faktor): besser als alles davor (schneller, bei Sprung/Wurf/Mehrkampf
-- weiter bzw. mehr) – beste Leistung vor 2025 laut WA und alle gespeicherten Ergebnisse an früheren Tagen (Staffeln nie).
-- Es muss vorher schon eine Leistung in der Disziplin geben. Vorlauf und Finale an verschiedenen Tagen können beide PB sein.
-- 1 = neue PB, 0.5 = PB eingestellt (=PB, gleiche Leistung), 0 = keine. In einem Durchgang über alle Ergebnisse (Fenster
-- je Athlet und Disziplin), damit auch zehntausende Ergebnisse schnell gehen.
drop function if exists _pb_factor(text, text, date, text);
create or replace function _pb_factors() returns table (wa_result_id bigint, factor numeric)
language sql stable as $$
  select x.id, case when x.cost is null or x.prior is null then 0 when x.cost < x.prior then 1 when x.cost = x.prior then 0.5 else 0 end
    from (select w.id, w.cost,
                 least(b.cost, min(w.cost) over (partition by w.athlete_id, w.discipline order by w.date
                                                 range between unbounded preceding and interval '1 day' preceding)) prior
            from (select o.id, o.athlete_id, o.discipline, o.date, _mark_cost(d.higher_better, o.mark) cost
                    from wa_results o left join disciplines d on d.name = o.discipline
                   where o.relay is null and not _is_relay(o.discipline) and not o.not_legal) w   -- Rückenwind: nie PB
            left join (select pb.athlete_id, pb.discipline, _mark_cost(d.higher_better, pb.mark) cost
                         from athlete_pb_before pb left join disciplines d on d.name = pb.discipline) b
              on b.athlete_id = w.athlete_id and b.discipline = w.discipline) x;
$$;

create or replace function rebuild_results(p_from date default null) returns int
language plpgsql security definer set search_path = public as $$
declare c scoring_config; n int;
begin
  select * into c from scoring_config where id = 1;
  delete from results where p_from is null or result_date >= p_from;
  insert into results (athlete_id, competition_id, label, result_date, rank, points, perf_points, placing_points, record_points, pb_points, wa_result_id)
  with pb as materialized (select * from _pb_factors())
  -- Ein Wettkampf = ein Ergebnis: je Athlet, Wettkampf und Disziplin bringen nur der besten Runde (Vorlauf, Halbfinale, Finale …)
  -- Leistungs- und Platzierungspunkte, damit Disziplinen mit vielen Runden (Sprint, Hürden) nicht mehrfach punkten.
  -- Bestleistungs- und Rekord-Bonus zählen in jeder Runde.
  select athlete_id, competition_id, label, date, place, p + plc2 + rec + pb, p, plc2, rec, pb, id
    from (select y.*, case when rn = 1 then perf else 0 end p, case when rn = 1 then plc else 0 end plc2
            from (select x.*, row_number() over (partition by athlete_id, competition_id, base
                                                  order by perf + plc desc, perf + plc + rec + pb desc, date desc, id) rn
                    from (
      -- Rückenwind (WA: zwei Zeilen derselben Runde, siehe wa_results.not_legal) = ein Ergebnis: Platz aus der gewerteten Leistung,
      -- Leistungspunkte aus dem besseren WA-Wert (WA rechnet den Wind schon ein), PB-/Rekord-Bonus nur aus der gültigen
      select (array_agg(id order by place is null, perf desc, id))[1] id, athlete_id, max(date) date, max(place) place,
             competition_id, label, base, max(perf) perf, max(plc) plc, max(rec) rec, max(pb) pb
        from (
      select w.id, w.athlete_id, w.date, w.place,
             -- Staffel: Leistungs- und Platzierungspunkte nur anteilig (1/3 bzw. 1/4)
             case w.record when 'WR' then c.record_wr when 'ER' then c.record_er when 'DR' then c.record_dr
                           when '=WR' then c.record_wr / 2.0 when '=ER' then c.record_er / 2.0 when '=DR' then c.record_dr / 2.0 else 0 end rec,
             -- PB-Bonus: nur für Leistungen ab der Schwelle, auch für Zwischenzeiten, nicht für Staffeln
             case when w.relay is null and coalesce(w.result_score, 0) >= c.perf_threshold
                  then c.pb_points * coalesce(pf.factor, 0) else 0 end pb,
             coalesce('wa-c' || w.wa_competition_id, 'wa-' || md5(w.competition || w.date::text)) competition_id,
             w.discipline || case when d.cross_table is not null and cross_km(w.competition) is not null
                                  then ' · ' || cross_km(w.competition) || 'km' else '' end
               || case when w.wa_race in ('', 'F') then '' else ' · ' || w.wa_race end label,
             -- Disziplin (bei Cross mit Distanz) ohne Runde: Schlüssel für „beste Runde je Wettkampf“
             w.discipline || coalesce(' · ' || case when d.cross_table is not null then cross_km(w.competition) end || 'km', '') base,
             -- Zwischenzeiten (z. B. 1500 m im Meilenrennen): keine Leistungs- und Platzierungspunkte, nur Rekord- und PB-Bonus.
             -- Einzeldisziplinen im Mehrkampf (Runde CE, CE1 …): Leistungspunkte wie sonst (nur über der Schwelle, also selten),
             -- aber keine Platzierungspunkte – die Platzierung zählt im Gesamtergebnis
             case when _is_split(w.competition, w.remark) then 0
                  when d.cross_table is not null then
                    round(greatest(0, coalesce((select ps.points from placing_scores ps
                                                 where ps.placing_table = d.cross_table and ps.category = w.category
                                                   and ps.race_type = 'F' and ps.place = w.place and _race_type(w.race) = 'F'), 0)
                                      - c.perf_threshold)
                          * c.cross_factor * coalesce(_cross_factor(cross_km(w.competition)), d.factor, 0), 2)
                  else round(greatest(0, coalesce(w.result_score, 0) - c.perf_threshold) * c.perf_factor * coalesce(d.factor, 0)
                             * coalesce(w.share, 1), 2)
             end perf,
             -- Meisterschaft im offenen Rennen (z. B. DM im Frankfurt-Marathon): der höhere Wert aus Platz im Rennen
             -- und Meisterschaftsplatz (champ_place, Kategorie champ_category, Standard B) zählt
             case when d.cross_table is not null or _is_split(w.competition, w.remark) or coalesce(w.wa_race, '') ~ '^CE' then 0
                  else round(greatest(
                         coalesce((select max(ps.points) from placing_scores ps
                                    where ps.placing_table = any (d.placing_tables) and ps.category = w.category
                                      and ps.race_type = coalesce(w.placing_round, _race_type(w.race))
                                      and ps.place = coalesce(w.placing_place, w.place)), 0),
                         coalesce((select max(ps.points) from placing_scores ps
                                    where ps.placing_table = any (d.placing_tables) and ps.category = coalesce(w.champ_category, 'B')
                                      and ps.race_type = 'F' and ps.place = w.champ_place), 0))
                          * c.placing_factor * coalesce(d.factor, 0) * coalesce(w.share, 1), 2)
             end plc
        from wa_results w left join disciplines d on d.name = w.discipline
        left join pb pf on pf.wa_result_id = w.id
       where (p_from is null or w.date >= p_from) and w.date >= date '2025-01-01'
         -- Nachtrag entfällt, sobald World Athletics dasselbe Ergebnis führt (gleiche Disziplin, ±1 Tag)
         and not (w.source = 'manual' and w.relay is null and exists (select 1 from wa_results o
                   where o.athlete_id = w.athlete_id and o.source = 'wa' and o.discipline = w.discipline
                     and abs(o.date - w.date) <= 1))
    ) r group by athlete_id, competition_id, label, base) x) y) z
   where p + plc2 + rec + pb > 0
  on conflict (athlete_id, competition_id, label) do nothing;
  get diagnostics n = row_count;
  perform refresh_pool();   -- Pool-Rang und Gruppe hängen an den Punkten im Bezugsjahr
  return n;
end $$;

-- Wertungsparameter ändern (gilt für alle Ligen) – darf jeder Liga-Admin; Punkte werden neu berechnet
create or replace function update_scoring_config(p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s jsonb := coalesce(p_settings, '{}');
begin
  if not exists (select 1 from leagues where admin_user = auth.uid()) and not _is_service() then
    raise exception 'Nur Liga-Admins dürfen die Wertung ändern.';
  end if;
  update scoring_config set
    pool_threshold = coalesce((s->>'pool_threshold')::int, pool_threshold),
    perf_threshold = coalesce((s->>'perf_threshold')::int, perf_threshold),
    perf_factor    = coalesce((s->>'perf_factor')::numeric, perf_factor),
    placing_factor = coalesce((s->>'placing_factor')::numeric, placing_factor),
    cross_factor   = coalesce((s->>'cross_factor')::numeric, cross_factor),
    new_group_threshold = coalesce((s->>'new_group_threshold')::int, new_group_threshold),
    record_dr      = coalesce((s->>'record_dr')::int, record_dr),
    pb_points      = coalesce((s->>'pb_points')::int, pb_points),
    record_er      = coalesce((s->>'record_er')::int, record_er),
    record_wr      = coalesce((s->>'record_wr')::int, record_wr),
    game_year      = case when s ? 'game_year' then nullif(s->>'game_year', '')::int else game_year end,
    updated_at     = now()
  where id = 1;
  if exists (select 1 from scoring_config where perf_factor < 0 or placing_factor < 0 or cross_factor < 0
              or record_dr < 0 or record_er < 0 or record_wr < 0 or pb_points < 0) then
    raise exception 'Faktoren und Rekordpunkte dürfen nicht negativ sein.';
  end if;
  perform rebuild_results(null);
  perform refresh_pool(null);   -- Gruppe und Pool-Rang hängen an Punkten, Spieljahr und Schwellen
  insert into admin_log (league_id, user_id, action, details)
    select id, auth.uid(), 'scoring_config', s from leagues where admin_user = auth.uid();
end $$;

-- Rekord an einem Ergebnis markieren (DR/ER/WR) oder entfernen (null) – jeder Liga-Admin; Punkte werden neu berechnet
-- Meisterschaftsplatz an einem Ergebnis eintragen (null = entfernen) – jeder Liga-Admin; Punkte werden neu berechnet
create or replace function set_result_champ(p_id bigint, p_place int, p_category text default 'B') returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not exists (select 1 from leagues where admin_user = auth.uid()) and not _is_service() then
    raise exception 'Nur Liga-Admins dürfen Meisterschaftsplätze eintragen.';
  end if;
  if p_place is not null and p_place < 1 then raise exception 'Ungültiger Platz.'; end if;
  if p_category is not null and p_category not in ('OW', 'DF', 'GW', 'GL', 'A', 'B', 'C', 'D', 'E', 'F') then
    raise exception 'Unbekannte Kategorie: %', p_category;
  end if;
  update wa_results set champ_place = p_place, champ_category = case when p_place is null then null else coalesce(p_category, 'B') end
   where id = p_id returning date into d;
  if d is null then raise exception 'Ergebnis nicht gefunden.'; end if;
  perform rebuild_results(d);
  perform refresh_season_stats(extract(year from d)::int);
  insert into admin_log (league_id, user_id, action, details)
    select id, auth.uid(), 'result_champ', jsonb_build_object('wa_result', p_id, 'place', p_place, 'category', p_category)
      from leagues where admin_user = auth.uid();
end $$;

create or replace function set_result_record(p_id bigint, p_record text) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not exists (select 1 from leagues where admin_user = auth.uid()) and not _is_service() then
    raise exception 'Nur Liga-Admins dürfen Rekorde eintragen.';
  end if;
  if p_record is not null and p_record not in ('DR', 'ER', 'WR', '=DR', '=ER', '=WR') then raise exception 'Unbekannter Rekord: %', p_record; end if;
  update wa_results set record = p_record where id = p_id returning date into d;
  if d is null then raise exception 'Ergebnis nicht gefunden.'; end if;
  perform rebuild_results(d);
  perform refresh_season_stats(extract(year from d)::int);
  insert into admin_log (league_id, user_id, action, details)
    select id, auth.uid(), 'result_record', jsonb_build_object('wa_result', p_id, 'record', p_record) from leagues where admin_user = auth.uid();
end $$;

-- Rekorde aus den All-time-Listen übernehmen (Importer): p_rows = [{athlete_id, discipline, date, mark, record}].
-- Kennzeichnet passende Ergebnisse (gleicher Tag, gleiche Zeit); ein höherer Rekord ersetzt einen niedrigeren, nie umgekehrt.
create or replace function apply_records(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int; d date;
begin
  if not _is_service() then raise exception 'Nur für den Importer.'; end if;
  with x as (
    select distinct on (w.id) w.id, j.record
      from jsonb_to_recordset(p_rows) j(athlete_id text, discipline text, date date, mark text, record text)
      join wa_results w on w.athlete_id = j.athlete_id and w.discipline = j.discipline and w.date = j.date and not w.not_legal
                       and mark_seconds(w.mark) = mark_seconds(j.mark)
     where _record_rank(j.record) > 0
     order by w.id, _record_rank(j.record) desc)
  update wa_results w set record = x.record from x
   where w.id = x.id and _record_rank(w.record) < _record_rank(x.record);
  get diagnostics n = row_count;
  if n > 0 then
    select min((j->>'date')::date) into d from jsonb_array_elements(p_rows) j;
    perform rebuild_results(d);
    for y in extract(year from d)::int .. extract(year from current_date)::int loop perform refresh_season_stats(y); end loop;
  end if;
  return n;
end $$;

-- Punkte pro Athlet in einem Jahr (für die Athletenliste der App); p_gender 'mixed' = alle
drop function if exists athlete_points(text, int, text[]);
drop function if exists athlete_points(text, int);
create or replace function athlete_points(p_gender text, p_year int, p_nation text default null)
returns table (athlete_id text, points numeric, results int)
language sql stable security definer set search_path = public as $$
  select r.athlete_id, sum(r.points), count(*)::int
    from results r join athletes x on x.id = r.athlete_id
   where _gender_ok(p_gender, x.gender) and _nation_ok(p_nation, x)
     and r.result_date >= make_date(p_year, 1, 1) and r.result_date <= make_date(p_year, 12, 31)
   group by r.athlete_id
   order by r.athlete_id;
$$;

-- Punkte der letzten Tage (Standard 30) – für „heiße freie Athleten“
drop function if exists athlete_points_recent(text, int, text[]);
drop function if exists athlete_points_recent(text, int);
create or replace function athlete_points_recent(p_gender text, p_days int default 30, p_nation text default null)
returns table (athlete_id text, points numeric, results int)
language sql stable security definer set search_path = public as $$
  select r.athlete_id, sum(r.points), count(*)::int
    from results r join athletes x on x.id = r.athlete_id
   where _gender_ok(p_gender, x.gender) and _nation_ok(p_nation, x) and r.result_date > current_date - p_days and r.points > 0
   group by r.athlete_id
   order by r.athlete_id;
$$;

-- Wettkämpfe → Top-Leistungen: einzelne Ergebnisse mit den meisten Punkten in einem Zeitraum, optional einer Disziplin;
-- mit p_manager nur Ergebnisse, die diesem Team in der Liga Punkte gebracht haben (Spieltag, ggf. aufgestellt – _score_rows);
-- p_order: 'points' (Fantasy-Punkte) oder 'wa' (WA-Punkte der Leistung)
drop function if exists top_results(text, date, date, text, int);
drop function if exists top_results(text, date, date, text, int, uuid, uuid);
drop function if exists top_results(text, date, date, text, int, uuid, uuid, text);
create or replace function top_results(p_gender text, p_from date, p_to date, p_discipline text default null, p_limit int default 100,
                                       p_league uuid default null, p_manager uuid default null, p_order text default 'points',
                                       p_nation text default null)
returns table (athlete_id text, result_date date, competition_id text, competition text, discipline text, race text, mark text,
               points numeric, perf_points numeric, placing_points numeric, pb_points numeric, record_points numeric, wa_points int)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_manager is not null and not (is_member(p_league) or _is_service()) then raise exception 'Keine Berechtigung.'; end if;
  return query
  with team as materialized (
    select distinct s.athlete_id, s.competition_id, s.label from _score_rows(p_league) s
     where p_manager is not null and s.manager_id = p_manager)
  select r.athlete_id, r.result_date, r.competition_id, coalesce(c.name, w.competition), coalesce(w.discipline, r.label),
         w.wa_race, w.mark, r.points, r.perf_points, r.placing_points, r.pb_points, r.record_points, w.result_score
    from results r join athletes x on x.id = r.athlete_id
         left join wa_results w on w.id = r.wa_result_id
         left join competitions c on c.id = r.competition_id
   where _gender_ok(p_gender, x.gender) and _nation_ok(p_nation, x) and r.result_date between p_from and p_to and r.points > 0
     and (p_discipline is null or w.discipline = p_discipline)
     and (p_manager is null or exists (select 1 from team t where t.athlete_id = r.athlete_id
                                         and t.competition_id = r.competition_id and t.label = r.label))
     and (p_order is distinct from 'wa' or w.result_score is not null)
   order by case when p_order = 'wa' then w.result_score end desc nulls last, r.points desc, r.result_date desc, r.id
   limit least(coalesce(p_limit, 100), 300);
end $$;

-- Saisonwertung je Jahr fest gespeichert (Rang und Punkte je Athlet, getrennt nach Männern/Frauen),
-- damit das Athletenfenster sie sofort zeigt. Wird nach jedem Ergebnisabruf neu berechnet.
create table if not exists athlete_season_stats (
  athlete_id  text not null references athletes (id) on delete cascade,
  year        int  not null,
  season_rank int  not null,
  points      numeric not null,
  athletes      int  not null,       -- Athleten mit Punkten in dieser Wertung und Saison
  primary key (athlete_id, year)
);

-- Platz über Männer und Frauen hinweg (für Mixed-Ligen)
alter table athlete_season_stats add column if not exists overall_rank int;
alter table athlete_season_stats add column if not exists overall_athletes int;

create or replace function refresh_season_stats(p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from athlete_season_stats where year = p_year;
  insert into athlete_season_stats (athlete_id, year, season_rank, points, athletes, overall_rank, overall_athletes)
  with s as (
    select r.athlete_id, x.gender, sum(r.points) pts
      from results r join athletes x on x.id = r.athlete_id
     where r.result_date >= make_date(p_year, 1, 1) and r.result_date <= make_date(p_year, 12, 31)
     group by 1, 2)
  select athlete_id, p_year, (rank() over (partition by gender order by pts desc))::int, pts,
         (count(*) over (partition by gender))::int, (rank() over (order by pts desc))::int, (count(*) over ())::int
    from s;
  get diagnostics n = row_count;
  return n;
end $$;

-- Jahre, für die Ergebnisse gespeichert sind (Auswahl „Sortiert nach Punkten …“)
create or replace function result_years() returns setof int
language sql stable security definer set search_path = public as $$
  select distinct extract(year from result_date)::int from results order by 1 desc;
$$;

create or replace function athlete_season_rank(p_slug text, p_year int)
returns table (season_rank int, points numeric, athletes int)
language sql stable security definer set search_path = public as $$
  select season_rank, points, athletes from athlete_season_stats where athlete_id = p_slug and year = p_year;
$$;

-- Herkunft der Punkte (einzelne Rennergebnisse)
create or replace function league_point_details(p_league uuid, p_matchday uuid default null)
returns table (matchday_id uuid, manager_id uuid, athlete_id text, competition_id text, race_name text,
               label text, result_date date, points numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p_league) then raise exception 'Keine Berechtigung.'; end if;
  return query
  select s.matchday_id, s.manager_id, s.athlete_id, s.competition_id, rc.name, s.label, s.result_date, s.points
    from _score_rows(p_league) s left join competitions rc on rc.id = s.competition_id
   where p_matchday is null or s.matchday_id = p_matchday
   order by s.result_date desc, s.points desc;
end $$;
