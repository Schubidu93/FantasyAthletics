-- =====================================================================
-- Leichtathletik: Geschlecht, Disziplingruppen, Positionen
-- =====================================================================

-- Disziplingruppe eines Athleten (800, 1500, 5000, 10000, Marathon, Hindernis)
create or replace function athlete_group(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(group_override, event_group) from athletes where id = p_slug;
$$;

-- Positionen der Aufstellung, z. B. {800,1500,…,WC1,WC2} oder im Mixed-Modus "je Disziplin m+w"
-- {800:M,800:W,1500:M,…,WC1,WC2}
create or replace function league_slots(p_groups text[], p_mode text, p_wildcards int) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x order by o), '{}') from (
    select g || case when p_mode = 'mf' then sfx else '' end x, gi * 10 + si o
      from unnest(p_groups) with ordinality a(g, gi)
      cross join (values (':M', 1), (':W', 2)) b(sfx, si)
     where p_mode = 'mf' or si = 1
    union all
    select 'WC' || n, 100000 + n from generate_series(1, greatest(coalesce(p_wildcards, 0), 0)) n
  ) t;
$$;

create or replace function league_slots(p_league uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select league_slots(lineup_groups, lineup_mode, wildcards) from leagues where id = p_league;
$$;

-- Darf der Athlet auf diese Position? Gruppe muss passen (außer Wildcard), bei ":M"/":W" auch das Geschlecht.
create or replace function _slot_ok(p_slot text, p_rider text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_slot, ':', 2) = 'M' and r.gender <> 'men' then false
    when split_part(p_slot, ':', 2) = 'W' and r.gender <> 'women' then false
    when p_slot like 'WC%' then true
    else coalesce(r.group_override, r.event_group) = split_part(p_slot, ':', 1) end
  from athletes r where r.id = p_rider;
$$;

-- Liga-Einstellungen vereinheitlichen: Zahl der Positionen = wertende Athleten
create or replace function _league_defaults() returns trigger
language plpgsql as $$
begin
  if new.gender <> 'mixed' then new.lineup_mode := 'free'; end if;
  new.lineup_groups := coalesce(new.lineup_groups, '{}');
  if new.scoring_mode = 'lineup' then
    new.lineup_size := cardinality(league_slots(new.lineup_groups, new.lineup_mode, new.wildcards));
    if new.lineup_size = 0 then raise exception 'Die Aufstellung braucht mindestens eine Position.'; end if;
    if new.lineup_size > new.roster_size then
      raise exception 'Der Kader muss mindestens so groß sein wie die Aufstellung (% Positionen).', new.lineup_size;
    end if;
  else
    new.lineup_size := null;
  end if;
  return new;
end $$;
drop trigger if exists leagues_defaults on leagues;
create trigger leagues_defaults before insert or update on leagues for each row execute function _league_defaults();
