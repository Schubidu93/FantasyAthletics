-- Fantasy Athletics – Grundschema
--
-- Prinzip: Alle Spielregeln (Draft, Aufstellung, Transfers, Punkte) liegen in der
-- Datenbank. Die App liest über Views und schreibt ausschließlich über die
-- RPC-Funktionen weiter unten, damit niemand die Regeln am Client vorbei umgehen kann.

-- ---------------------------------------------------------------------------
-- Referenzdaten
-- ---------------------------------------------------------------------------

-- WA-Disziplinname -> Faktor, Athletengruppe (für Aufstellungs-Positionen) und
-- Gruppe der Platzierungstabelle.
create table public.disciplines (
  name text primary key,
  factor numeric not null default 1,
  event_group text,
  placing_group text
);

-- Platzierungspunkte nach WA-World-Ranking-Logik.
-- race_type: 'F' = Finale, 'SF' = Halbfinale.
create table public.placing_scores (
  placing_group text not null,
  category text not null,
  race_type text not null check (race_type in ('F', 'SF')),
  place int not null check (place > 0),
  points int not null,
  primary key (placing_group, category, race_type, place)
);

-- ---------------------------------------------------------------------------
-- Athleten & Ergebnisse (werden vom Importer befüllt)
-- ---------------------------------------------------------------------------

create table public.athletes (
  id bigint primary key, -- World Athletics ID
  name text not null,
  gender text check (gender in ('M', 'W')),
  birth_year int,
  country text not null default 'GER',
  -- Manuelle Zuordnung zu einer Gruppe (800, 1500, 5000, 10000, Marathon, Hindernis).
  -- Ohne Override ergibt sich die Gruppe aus der besten Toplisten-Leistung.
  group_override text,
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.toplist_entries (
  athlete_id bigint not null references public.athletes (id) on delete cascade,
  year int not null,
  discipline text not null,
  mark text,
  score int not null,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, year, discipline)
);

create table public.results (
  id bigserial primary key,
  athlete_id bigint not null references public.athletes (id) on delete cascade,
  date date not null,
  competition text not null default '',
  venue text,
  discipline text not null,
  country text,
  category text,
  race text not null default '',
  place int,
  mark text,
  result_score int,
  remark text,
  wa_competition_id bigint,
  wa_event_id bigint,
  source text not null default 'worldathletics' check (source in ('worldathletics', 'manual')),
  imported_at timestamptz not null default now(),
  unique (athlete_id, date, discipline, race, competition)
);
create index results_date_idx on public.results (date);

create table public.import_runs (
  id bigserial primary key,
  kind text not null check (kind in ('pool', 'results')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  message text
);

-- ---------------------------------------------------------------------------
-- Spieler, Saisons, Spieltage
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.seasons (
  id serial primary key,
  year int not null,
  name text not null,
  join_code text not null unique default substr(md5(random()::text), 1, 8),
  status text not null default 'setup' check (status in ('setup', 'drafting', 'active', 'finished')),
  created_by uuid references auth.users (id),
  -- Athletenpool: WA-Punkte in der DE-Topliste (Saisonjahr oder Vorjahr) >= pool_threshold
  pool_threshold int not null default 1000,
  -- Leistungspunkte = max(0, WA-Punkte - perf_threshold) * perf_factor * Disziplinfaktor
  perf_threshold int not null default 1000,
  perf_factor numeric not null default 1,
  -- Platzierungspunkte = Tabellenwert * placing_factor * Disziplinfaktor
  placing_factor numeric not null default 1,
  roster_size int not null default 11 check (roster_size > 0),
  lineup_slots text[] not null default array['800', '1500', '5000', '10000', 'Marathon', 'Hindernis', 'WC1', 'WC2'],
  draft_starts_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.season_members (
  id serial primary key,
  season_id int not null references public.seasons (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_name text not null,
  draft_position int,
  joined_at timestamptz not null default now(),
  unique (season_id, user_id),
  unique (season_id, draft_position)
);

create table public.matchdays (
  id serial primary key,
  season_id int not null references public.seasons (id) on delete cascade,
  number int not null,
  starts_on date not null,
  ends_on date not null,
  check (ends_on >= starts_on),
  unique (season_id, number)
);

-- ---------------------------------------------------------------------------
-- Draft, Kader, Aufstellung, Trades
-- ---------------------------------------------------------------------------

create table public.draft_picks (
  season_id int not null references public.seasons (id) on delete cascade,
  pick_no int not null,
  member_id int not null references public.season_members (id) on delete cascade,
  athlete_id bigint not null references public.athletes (id),
  picked_at timestamptz not null default now(),
  primary key (season_id, pick_no),
  unique (season_id, athlete_id)
);

-- Kaderhistorie: ein Eintrag pro Zugehörigkeit. Aktueller Kader = released_at is null.
create table public.roster_entries (
  id serial primary key,
  season_id int not null references public.seasons (id) on delete cascade,
  member_id int not null references public.season_members (id) on delete cascade,
  athlete_id bigint not null references public.athletes (id),
  acquired_at timestamptz not null default now(),
  released_at timestamptz,
  acquired_via text not null check (acquired_via in ('draft', 'free_agent', 'trade', 'admin'))
);
create unique index roster_one_owner on public.roster_entries (season_id, athlete_id) where released_at is null;

-- Eine Aufstellung gilt ab Spieltag from_matchday, bis eine spätere gesetzt wird.
-- Es wird immer die komplette Aufstellung gespeichert (alle Positionen).
create table public.lineup_entries (
  member_id int not null references public.season_members (id) on delete cascade,
  from_matchday int not null,
  slot text not null,
  athlete_id bigint not null references public.athletes (id),
  updated_at timestamptz not null default now(),
  primary key (member_id, from_matchday, slot),
  unique (member_id, from_matchday, athlete_id)
);

create table public.trades (
  id serial primary key,
  season_id int not null references public.seasons (id) on delete cascade,
  proposer_id int not null references public.season_members (id) on delete cascade,
  receiver_id int not null references public.season_members (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'invalid')),
  message text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.trade_items (
  trade_id int not null references public.trades (id) on delete cascade,
  athlete_id bigint not null references public.athletes (id),
  from_member_id int not null references public.season_members (id) on delete cascade,
  primary key (trade_id, athlete_id)
);

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen
-- ---------------------------------------------------------------------------

create function public.berlin_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Berlin')::date $$;

create function public.is_season_admin(p_season int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from seasons where id = p_season and created_by = auth.uid())
      or exists (select 1 from profiles where id = auth.uid() and is_admin)
$$;

create function public.my_member_id(p_season int) returns int
language sql stable security definer set search_path = public as $$
  select id from season_members where season_id = p_season and user_id = auth.uid()
$$;

-- 'F' für Finale, 'SF' für Halbfinale, sonst null (Vorläufe bekommen keine Platzierungspunkte).
-- Mehrere Finalläufe (F1, F2, ...) zählen bewusst nicht: die Platzierung im Lauf ist
-- nicht die Gesamtplatzierung.
create function public.race_type(p_race text) returns text
language sql immutable as $$
  select case
    when p_race is null or p_race in ('', 'F') then 'F'
    when p_race ~ '^SF[0-9]*$' then 'SF'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Athlet mit Gruppe und bester Toplistenleistung.
create view public.athlete_overview with (security_invoker = true) as
select
  a.*,
  coalesce(a.group_override, best.event_group) as event_group,
  best.discipline as best_discipline,
  best.mark as best_mark,
  best.score as best_score,
  best.year as best_year
from public.athletes a
left join lateral (
  select t.discipline, t.mark, t.score, t.year, d.event_group
  from public.toplist_entries t
  left join public.disciplines d on d.name = t.discipline
  where t.athlete_id = a.id and d.event_group is not null
  order by t.score desc, t.year desc
  limit 1
) best on true;

-- Athletenpool je Saison: DE-Toplisten Saisonjahr + Vorjahr über Schwelle.
-- Wer einmal im Kader war, bleibt im Pool (auch bei Karriereende o.ä.).
create view public.season_pool with (security_invoker = true) as
select season_id, athlete_id, max(score) as qualifying_score
from (
  select s.id as season_id, t.athlete_id, t.score
  from public.seasons s
  join public.toplist_entries t on t.year in (s.year, s.year - 1) and t.score >= s.pool_threshold
  join public.athletes a on a.id = t.athlete_id and not a.retired
  union all
  select r.season_id, r.athlete_id, null
  from public.roster_entries r
) p
group by season_id, athlete_id;

-- Punkte pro Ergebnis und Saison.
create view public.result_points with (security_invoker = true) as
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
    as total_points
from public.results r
join public.seasons s on extract(year from r.date) = s.year
left join public.disciplines d on d.name = r.discipline
left join public.placing_scores ps
  on ps.placing_group = d.placing_group
 and ps.category = r.category
 and ps.race_type = public.race_type(r.race)
 and ps.place = r.place;

-- Gültige Aufstellung je Spieltag: jüngste Aufstellung mit from_matchday <= Spieltag.
create view public.effective_lineups with (security_invoker = true) as
select m.season_id, m.id as matchday_id, m.number as matchday, m.starts_on, m.ends_on,
       sm.id as member_id, le.slot, le.athlete_id
from public.matchdays m
join public.season_members sm on sm.season_id = m.season_id
join lateral (
  select max(l.from_matchday) as from_matchday
  from public.lineup_entries l
  where l.member_id = sm.id and l.from_matchday <= m.number
) cur on cur.from_matchday is not null
join public.lineup_entries le on le.member_id = sm.id and le.from_matchday = cur.from_matchday;

-- Ergebnisse, die für ein Team zählen: Athlet war im Spieltag aufgestellt UND am
-- Wettkampftag im Kader dieses Teams.
create view public.scored_results with (security_invoker = true) as
select el.matchday_id, el.matchday, el.member_id, el.slot, rp.*
from public.effective_lineups el
join public.result_points rp
  on rp.athlete_id = el.athlete_id
 and rp.season_id = el.season_id
 and rp.date between el.starts_on and el.ends_on
where exists (
  select 1 from public.roster_entries re
  where re.member_id = el.member_id
    and re.athlete_id = el.athlete_id
    and (re.acquired_at at time zone 'Europe/Berlin')::date <= rp.date
    and (re.released_at is null or (re.released_at at time zone 'Europe/Berlin')::date > rp.date)
);

create view public.matchday_standings with (security_invoker = true) as
select m.season_id, m.id as matchday_id, m.number as matchday, sm.id as member_id, sm.team_name,
       coalesce(sum(sr.total_points), 0) as points
from public.matchdays m
join public.season_members sm on sm.season_id = m.season_id
left join public.scored_results sr on sr.member_id = sm.id and sr.matchday_id = m.id
group by m.season_id, m.id, m.number, sm.id, sm.team_name;

create view public.standings with (security_invoker = true) as
select sm.season_id, sm.id as member_id, sm.team_name, sm.user_id,
       coalesce(sum(sr.total_points), 0) as points,
       count(sr.result_id) as scored_results
from public.season_members sm
left join public.scored_results sr on sr.member_id = sm.id
group by sm.season_id, sm.id, sm.team_name, sm.user_id;

create view public.athlete_season_points with (security_invoker = true) as
select season_id, athlete_id, sum(total_points) as points, count(*) as results, max(date) as last_result
from public.result_points
group by season_id, athlete_id;

-- Pool mit Besitzer und Saisonpunkten (für Athletenliste, Draft, Free Agents).
create view public.pool_overview with (security_invoker = true) as
select p.season_id, p.qualifying_score, ao.*,
       re.member_id as owner_member_id, sm.team_name as owner_team,
       coalesce(asp.points, 0) as season_points, coalesce(asp.results, 0) as season_results, asp.last_result
from public.season_pool p
join public.athlete_overview ao on ao.id = p.athlete_id
left join public.roster_entries re on re.season_id = p.season_id and re.athlete_id = p.athlete_id and re.released_at is null
left join public.season_members sm on sm.id = re.member_id
left join public.athlete_season_points asp on asp.season_id = p.season_id and asp.athlete_id = p.athlete_id;

-- Aktueller Kader inkl. Athleteninfos.
create view public.current_rosters with (security_invoker = true) as
select re.season_id, re.member_id, re.acquired_at, re.acquired_via, ao.*
from public.roster_entries re
join public.athlete_overview ao on ao.id = re.athlete_id
where re.released_at is null;

-- ---------------------------------------------------------------------------
-- Draft
-- ---------------------------------------------------------------------------

-- Snake-Draft: Runde 1 vorwärts, Runde 2 rückwärts, ...
create function public.draft_member_for_pick(p_season int, p_pick_no int) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  rnd int;
  pos int;
begin
  select count(*) into n from season_members where season_id = p_season;
  if n = 0 then return null; end if;
  rnd := (p_pick_no - 1) / n;
  pos := (p_pick_no - 1) % n;
  if rnd % 2 = 1 then pos := n - 1 - pos; end if;
  return (select id from season_members where season_id = p_season and draft_position = pos + 1);
end $$;

create function public.draft_state(p_season int)
returns table (next_pick_no int, total_picks int, member_id int, round int, finished boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  n int;
  total int;
  nxt int;
begin
  select count(*) into n from season_members where season_id = p_season;
  select n * roster_size into total from seasons where id = p_season;
  select coalesce(max(pick_no), 0) + 1 into nxt from draft_picks where season_id = p_season;
  return query select nxt, total,
    case when nxt <= total then draft_member_for_pick(p_season, nxt) end,
    case when n > 0 then (nxt - 1) / n + 1 end,
    nxt > total;
end $$;

create function public.start_draft(p_season int) returns void
language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  if not is_season_admin(p_season) then raise exception 'Nur Admins können den Draft starten'; end if;
  select count(*) into n from season_members where season_id = p_season;
  if n < 2 then raise exception 'Mindestens zwei Teams nötig'; end if;
  if exists (select 1 from season_members where season_id = p_season and draft_position is null)
     or (select max(draft_position) from season_members where season_id = p_season) <> n then
    raise exception 'Draft-Reihenfolge ist unvollständig';
  end if;
  update seasons set status = 'drafting', draft_starts_at = coalesce(draft_starts_at, now())
  where id = p_season and status = 'setup';
  if not found then raise exception 'Saison ist nicht in der Vorbereitung'; end if;
end $$;

create function public.set_draft_order(p_season int, p_member_ids int[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_season_admin(p_season) then raise exception 'Nur Admins'; end if;
  if (select status from seasons where id = p_season) <> 'setup' then
    raise exception 'Reihenfolge nur vor dem Draft änderbar';
  end if;
  if (select count(*) from season_members where season_id = p_season) <> coalesce(array_length(p_member_ids, 1), 0)
     or exists (select 1 from unnest(p_member_ids) m(id)
                where not exists (select 1 from season_members where id = m.id and season_id = p_season)) then
    raise exception 'Die Reihenfolge muss alle Teams genau einmal enthalten';
  end if;
  update season_members set draft_position = null where season_id = p_season;
  update season_members sm set draft_position = o.ord
  from unnest(p_member_ids) with ordinality o(id, ord)
  where sm.id = o.id;
end $$;

create function public.make_draft_pick(p_season int, p_athlete bigint) returns int
language plpgsql security definer set search_path = public as $$
declare
  st record;
  me int := my_member_id(p_season);
begin
  -- Serialisiert gleichzeitige Picks derselben Saison.
  perform 1 from seasons where id = p_season for update;
  if (select status from seasons where id = p_season) <> 'drafting' then
    raise exception 'Der Draft läuft gerade nicht';
  end if;
  select * into st from draft_state(p_season);
  if st.member_id is distinct from me and not is_season_admin(p_season) then
    raise exception 'Du bist nicht am Zug';
  end if;
  if not exists (select 1 from season_pool where season_id = p_season and athlete_id = p_athlete) then
    raise exception 'Athlet ist nicht im Pool';
  end if;
  if exists (select 1 from roster_entries where season_id = p_season and athlete_id = p_athlete and released_at is null) then
    raise exception 'Athlet ist bereits vergeben';
  end if;

  insert into draft_picks (season_id, pick_no, member_id, athlete_id)
  values (p_season, st.next_pick_no, st.member_id, p_athlete);
  insert into roster_entries (season_id, member_id, athlete_id, acquired_via)
  values (p_season, st.member_id, p_athlete, 'draft');

  if st.next_pick_no >= st.total_picks then
    update seasons set status = 'active' where id = p_season;
  end if;
  return st.next_pick_no;
end $$;

-- Draft vorzeitig beenden (z. B. wenn der Pool nicht für alle Runden reicht).
create function public.finish_draft(p_season int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_season_admin(p_season) then raise exception 'Nur Admins'; end if;
  update seasons set status = 'active' where id = p_season and status = 'drafting';
end $$;

-- Letzten Pick zurücknehmen (Admin, z. B. bei Verklickern).
create function public.undo_last_pick(p_season int) returns void
language plpgsql security definer set search_path = public as $$
declare
  last record;
begin
  if not is_season_admin(p_season) then raise exception 'Nur Admins'; end if;
  select * into last from draft_picks where season_id = p_season order by pick_no desc limit 1;
  if last is null then return; end if;
  delete from roster_entries
  where season_id = p_season and athlete_id = last.athlete_id and acquired_via = 'draft' and released_at is null;
  delete from draft_picks where season_id = p_season and pick_no = last.pick_no;
  update seasons set status = 'drafting' where id = p_season and status = 'active';
end $$;

-- ---------------------------------------------------------------------------
-- Aufstellung
-- ---------------------------------------------------------------------------

-- p_lineup: {"800": 14914521, "1500": ..., "WC1": ...}. Positionen ohne 'WC'-Präfix
-- dürfen nur mit Athleten der passenden Gruppe besetzt werden.
-- Zukünftige Spieltage sind frei änderbar. Im laufenden Spieltag dürfen nur Positionen
-- geändert werden, die leer sind oder mit einem nicht mehr im Kader befindlichen
-- Athleten besetzt waren.
create function public.set_lineup(p_season int, p_matchday int, p_lineup jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := my_member_id(p_season);
  s seasons;
  md matchdays;
  slot text;
  ath bigint;
  grp text;
  prev_from int;
  prev_ath bigint;
begin
  if me is null then raise exception 'Du spielst in dieser Saison nicht mit'; end if;
  select * into s from seasons where id = p_season;
  if s.status not in ('drafting', 'active') then raise exception 'Aufstellungen sind gerade nicht möglich'; end if;
  select * into md from matchdays where season_id = p_season and number = p_matchday;
  if md is null then raise exception 'Unbekannter Spieltag'; end if;
  if md.ends_on < berlin_today() then raise exception 'Spieltag ist bereits vorbei'; end if;

  for slot in select jsonb_object_keys(p_lineup) loop
    if not slot = any (s.lineup_slots) then raise exception 'Unbekannte Position %', slot; end if;
  end loop;

  if (select count(distinct value) from jsonb_each_text(p_lineup) where value is not null)
     <> (select count(*) from jsonb_each_text(p_lineup) where value is not null) then
    raise exception 'Ein Athlet kann nur einmal aufgestellt werden';
  end if;

  select max(from_matchday) into prev_from from lineup_entries
  where member_id = me and from_matchday <= p_matchday;

  for slot, ath in select key, (value)::bigint from jsonb_each_text(p_lineup) where value is not null loop
    if not exists (select 1 from roster_entries
                   where member_id = me and athlete_id = ath and released_at is null) then
      raise exception 'Athlet % ist nicht in deinem Kader', ath;
    end if;
    if slot not like 'WC%' then
      select event_group into grp from athlete_overview where id = ath;
      if grp is distinct from slot then
        raise exception 'Athlet % gehört zur Gruppe %, nicht %', ath, coalesce(grp, '-'), slot;
      end if;
    end if;
  end loop;

  if md.starts_on <= berlin_today() then
    -- Laufender Spieltag: Positionen mit einem (noch im Kader befindlichen) Athleten sind
    -- gesperrt, nur leere oder verwaiste Positionen dürfen nachbesetzt werden.
    for slot, prev_ath in select l.slot, l.athlete_id from lineup_entries l
                          where l.member_id = me and l.from_matchday = prev_from loop
      if (p_lineup ->> slot) is distinct from prev_ath::text and exists (
        select 1 from roster_entries where member_id = me and athlete_id = prev_ath and released_at is null
      ) then
        raise exception 'Spieltag % läuft bereits – Position % ist gesperrt', p_matchday, slot;
      end if;
    end loop;
  end if;

  delete from lineup_entries where member_id = me and from_matchday = p_matchday;
  insert into lineup_entries (member_id, from_matchday, slot, athlete_id)
  select me, p_matchday, key, (value)::bigint from jsonb_each_text(p_lineup) where value is not null;
end $$;

-- ---------------------------------------------------------------------------
-- Free Agents & Trades
-- ---------------------------------------------------------------------------

create function public.claim_free_agent(p_season int, p_add bigint, p_drop bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := my_member_id(p_season);
  s seasons;
  cnt int;
begin
  if me is null then raise exception 'Du spielst in dieser Saison nicht mit'; end if;
  select * into s from seasons where id = p_season for update;
  if s.status <> 'active' then raise exception 'Transfers erst nach dem Draft möglich'; end if;
  if not exists (select 1 from season_pool where season_id = p_season and athlete_id = p_add) then
    raise exception 'Athlet ist nicht im Pool';
  end if;
  if exists (select 1 from roster_entries where season_id = p_season and athlete_id = p_add and released_at is null) then
    raise exception 'Athlet ist bereits vergeben';
  end if;
  if p_drop is not null then
    update roster_entries set released_at = now()
    where member_id = me and athlete_id = p_drop and released_at is null;
    if not found then raise exception 'Abzugebender Athlet ist nicht in deinem Kader'; end if;
  end if;
  select count(*) into cnt from roster_entries where member_id = me and released_at is null;
  if cnt >= s.roster_size then raise exception 'Kader ist voll – gib zuerst einen Athleten ab'; end if;
  insert into roster_entries (season_id, member_id, athlete_id, acquired_via)
  values (p_season, me, p_add, 'free_agent');
end $$;

create function public.release_athlete(p_season int, p_athlete bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := my_member_id(p_season);
begin
  if (select status from seasons where id = p_season) <> 'active' then
    raise exception 'Transfers erst nach dem Draft möglich';
  end if;
  update roster_entries set released_at = now()
  where member_id = me and athlete_id = p_athlete and released_at is null;
  if not found then raise exception 'Athlet ist nicht in deinem Kader'; end if;
end $$;

create function public.propose_trade(
  p_season int, p_receiver int, p_give bigint[], p_get bigint[], p_message text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  me int := my_member_id(p_season);
  tid int;
begin
  if me is null then raise exception 'Du spielst in dieser Saison nicht mit'; end if;
  if (select status from seasons where id = p_season) <> 'active' then
    raise exception 'Trades erst nach dem Draft möglich';
  end if;
  if p_receiver = me then raise exception 'Kein Trade mit dir selbst'; end if;
  if not exists (select 1 from season_members where id = p_receiver and season_id = p_season) then
    raise exception 'Unbekanntes Team';
  end if;
  if coalesce(array_length(p_give, 1), 0) + coalesce(array_length(p_get, 1), 0) = 0 then
    raise exception 'Leerer Trade';
  end if;
  if exists (select 1 from unnest(p_give) a(id) where not exists (
      select 1 from roster_entries where member_id = me and athlete_id = a.id and released_at is null)) then
    raise exception 'Du kannst nur eigene Athleten anbieten';
  end if;
  if exists (select 1 from unnest(p_get) a(id) where not exists (
      select 1 from roster_entries where member_id = p_receiver and athlete_id = a.id and released_at is null)) then
    raise exception 'Gewünschte Athleten gehören nicht zum anderen Team';
  end if;

  insert into trades (season_id, proposer_id, receiver_id, message)
  values (p_season, me, p_receiver, p_message) returning id into tid;
  insert into trade_items (trade_id, athlete_id, from_member_id)
  select tid, a, me from unnest(p_give) a
  union all
  select tid, a, p_receiver from unnest(p_get) a;
  return tid;
end $$;

create function public.respond_trade(p_trade int, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  t trades;
  s seasons;
  item record;
  to_member int;
begin
  select * into t from trades where id = p_trade for update;
  if t is null or t.status <> 'pending' then raise exception 'Trade ist nicht mehr offen'; end if;

  if my_member_id(t.season_id) = t.proposer_id and not p_accept then
    update trades set status = 'cancelled', decided_at = now() where id = p_trade;
    return 'cancelled';
  end if;
  if my_member_id(t.season_id) is distinct from t.receiver_id then
    raise exception 'Nur das angefragte Team kann antworten';
  end if;
  if not p_accept then
    update trades set status = 'rejected', decided_at = now() where id = p_trade;
    return 'rejected';
  end if;

  select * into s from seasons where id = t.season_id for update;
  -- Besitz prüfen (kann sich seit dem Angebot geändert haben)
  if exists (select 1 from trade_items ti where ti.trade_id = p_trade and not exists (
      select 1 from roster_entries re where re.member_id = ti.from_member_id
        and re.athlete_id = ti.athlete_id and re.released_at is null)) then
    update trades set status = 'invalid', decided_at = now() where id = p_trade;
    return 'invalid';
  end if;

  for item in select * from trade_items where trade_id = p_trade loop
    to_member := case when item.from_member_id = t.proposer_id then t.receiver_id else t.proposer_id end;
    update roster_entries set released_at = now()
    where member_id = item.from_member_id and athlete_id = item.athlete_id and released_at is null;
    insert into roster_entries (season_id, member_id, athlete_id, acquired_via)
    values (t.season_id, to_member, item.athlete_id, 'trade');
  end loop;

  if (select count(*) from roster_entries where member_id = t.proposer_id and released_at is null) > s.roster_size
     or (select count(*) from roster_entries where member_id = t.receiver_id and released_at is null) > s.roster_size then
    raise exception 'Nach dem Trade wäre ein Kader zu groß (max. %)', s.roster_size;
  end if;

  update trades set status = 'accepted', decided_at = now() where id = p_trade;
  -- Andere offene Trades mit diesen Athleten sind damit hinfällig.
  update trades set status = 'invalid', decided_at = now()
  where status = 'pending' and id <> p_trade
    and exists (select 1 from trade_items a join trade_items b on a.athlete_id = b.athlete_id
                where a.trade_id = trades.id and b.trade_id = p_trade);
  return 'accepted';
end $$;

-- ---------------------------------------------------------------------------
-- Saisonverwaltung
-- ---------------------------------------------------------------------------

create function public.create_season(p_year int, p_name text, p_team_name text) returns int
language plpgsql security definer set search_path = public as $$
declare
  sid int;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  insert into seasons (year, name, created_by) values (p_year, p_name, auth.uid()) returning id into sid;
  insert into season_members (season_id, user_id, team_name) values (sid, auth.uid(), p_team_name);
  return sid;
end $$;

create function public.join_season(p_code text, p_team_name text) returns int
language plpgsql security definer set search_path = public as $$
declare
  s seasons;
begin
  if auth.uid() is null then raise exception 'Nicht angemeldet'; end if;
  select * into s from seasons where join_code = lower(trim(p_code));
  if s is null then raise exception 'Unbekannter Einladungscode'; end if;
  if s.status <> 'setup' then raise exception 'Die Saison hat schon begonnen'; end if;
  insert into season_members (season_id, user_id, team_name) values (s.id, auth.uid(), p_team_name)
  on conflict (season_id, user_id) do update set team_name = excluded.team_name;
  return s.id;
end $$;

-- Spieltage gleichmäßig über den Zeitraum verteilen (überschreibt bestehende).
create function public.generate_matchdays(p_season int, p_first date, p_last date, p_days int) returns int
language plpgsql security definer set search_path = public as $$
declare
  d date := p_first;
  n int := 0;
begin
  if not is_season_admin(p_season) then raise exception 'Nur Admins'; end if;
  if p_days < 1 then raise exception 'Länge muss mindestens 1 Tag sein'; end if;
  delete from matchdays where season_id = p_season;
  while d <= p_last loop
    n := n + 1;
    insert into matchdays (season_id, number, starts_on, ends_on)
    values (p_season, n, d, least(d + p_days - 1, p_last));
    d := d + p_days;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security: alle angemeldeten Spieler dürfen alles lesen,
-- geschrieben wird über die Funktionen oben (bzw. vom Importer mit Service-Key).
-- ---------------------------------------------------------------------------

alter table public.disciplines enable row level security;
alter table public.placing_scores enable row level security;
alter table public.athletes enable row level security;
alter table public.toplist_entries enable row level security;
alter table public.results enable row level security;
alter table public.import_runs enable row level security;
alter table public.profiles enable row level security;
alter table public.seasons enable row level security;
alter table public.season_members enable row level security;
alter table public.matchdays enable row level security;
alter table public.draft_picks enable row level security;
alter table public.roster_entries enable row level security;
alter table public.lineup_entries enable row level security;
alter table public.trades enable row level security;
alter table public.trade_items enable row level security;

create policy "read" on public.disciplines for select to authenticated using (true);
create policy "read" on public.placing_scores for select to authenticated using (true);
create policy "read" on public.athletes for select to authenticated using (true);
create policy "read" on public.toplist_entries for select to authenticated using (true);
create policy "read" on public.results for select to authenticated using (true);
create policy "read" on public.import_runs for select to authenticated using (true);
create policy "read" on public.profiles for select to authenticated using (true);
create policy "read" on public.seasons for select to authenticated using (true);
create policy "read" on public.season_members for select to authenticated using (true);
create policy "read" on public.matchdays for select to authenticated using (true);
create policy "read" on public.draft_picks for select to authenticated using (true);
create policy "read" on public.roster_entries for select to authenticated using (true);
create policy "read" on public.lineup_entries for select to authenticated using (true);
create policy "read" on public.trades for select to authenticated using (true);
create policy "read" on public.trade_items for select to authenticated using (true);

create policy "own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));
create policy "own team name" on public.season_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "admin season" on public.seasons for update to authenticated
  using (public.is_season_admin(id)) with check (public.is_season_admin(id));
create policy "admin matchdays" on public.matchdays for all to authenticated
  using (public.is_season_admin(season_id)) with check (public.is_season_admin(season_id));
create policy "admin disciplines" on public.disciplines for all to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
create policy "admin athletes" on public.athletes for update to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (exists (select 1 from public.profiles where id = auth.uid() and is_admin));
create policy "admin manual results" on public.results for all to authenticated
  using (source = 'manual' and exists (select 1 from public.profiles where id = auth.uid() and is_admin))
  with check (source = 'manual' and exists (select 1 from public.profiles where id = auth.uid() and is_admin));

-- Live-Updates für Draft und Transfers
alter publication supabase_realtime add table public.draft_picks, public.roster_entries, public.trades, public.seasons;
