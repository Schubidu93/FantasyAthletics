-- =====================================================================
-- Aufstellung
-- =====================================================================

-- Automatische Aufstellung (wenn noch keine gesetzt wurde): Positionen der Reihe nach mit den
-- teuersten bzw. bestplatzierten passenden Athleten des Kaders besetzen, Wildcards zuletzt.
create or replace function _auto_lineup(p_matchday uuid, p_manager uuid)
returns table (slot text, athlete_id text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare md matchdays; v_slot text; v_used text[] := '{}'; v_pick text;
begin
  select * into md from matchdays where id = p_matchday;
  foreach v_slot in array league_slots(md.league_id) loop
    select re.athlete_id into v_pick
      from roster_entries re join athletes r on r.id = re.athlete_id
     where re.manager_id = p_manager and re.acquired_on <= md.starts_on
       and (re.released_on is null or re.released_on > md.starts_on)
       and not (re.athlete_id = any (v_used)) and _slot_ok(v_slot, re.athlete_id)
     order by re.price desc, r.pool_rank nulls last, re.id
     limit 1;
    if v_pick is not null then
      v_used := v_used || v_pick;
      slot := v_slot; athlete_id := v_pick;
      return next;
    end if;
  end loop;
end $$;

-- Gültige Aufstellung mit Positionen: letzte gesetzte Aufstellung bis zu diesem Spieltag,
-- sonst die automatische.
create or replace function effective_lineup_slots(p_matchday uuid, p_manager uuid)
returns table (slot text, athlete_id text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare md matchdays; v_src uuid;
begin
  select * into md from matchdays where id = p_matchday;
  select lm.id into v_src from matchdays lm
   where lm.league_id = md.league_id and lm.starts_on <= md.starts_on
     and exists (select 1 from lineups x where x.matchday_id = lm.id and x.manager_id = p_manager)
   order by lm.starts_on desc limit 1;
  if v_src is not null then
    return query select x.slot, x.athlete_id from lineups x where x.matchday_id = v_src and x.manager_id = p_manager;
    return;
  end if;
  return query select a.slot, a.athlete_id from _auto_lineup(p_matchday, p_manager) a;
end $$;

create or replace function effective_lineup(p_matchday uuid, p_manager uuid) returns setof text
language sql stable security definer set search_path = public as $$
  select e.athlete_id from effective_lineup_slots(p_matchday, p_manager) e;
$$;

-- Aufstellung speichern: p_lineup = {"800": "wa-123", "1500:W": "wa-456", "WC1": null, …}
-- Leere Positionen sind erlaubt (z. B. wenn für eine Gruppe kein Athlet im Kader ist).
drop function if exists set_lineup(uuid, text[]);
create or replace function set_lineup(p_matchday uuid, p_lineup jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare md matchdays; l leagues; v_me uuid; v_slots text[]; e record;
begin
  select * into md from matchdays where id = p_matchday;
  if not found then raise exception 'Spieltag nicht gefunden.'; end if;
  v_me := _require_member(md.league_id);
  select * into l from leagues where id = md.league_id;
  if now() >= md.deadline then raise exception 'Der Stichtag für diesen Spieltag ist vorbei.'; end if;
  if l.scoring_mode <> 'lineup' then raise exception 'Die Liga wertet den Gesamtkader.'; end if;
  v_slots := league_slots(l.id);
  create temp table _lu on commit drop as
    select key slot, value athlete_id from jsonb_each_text(coalesce(p_lineup, '{}')) where value is not null and value <> '';
  if exists (select 1 from _lu where not (slot = any (v_slots))) then
    raise exception 'Unbekannte Position.';
  end if;
  if (select count(*) from _lu) <> (select count(distinct athlete_id) from _lu) then
    raise exception 'Ein Athlet kann nur einmal aufgestellt werden.';
  end if;
  for e in select * from _lu loop
    if not exists (select 1 from roster_entries re where re.manager_id = v_me and re.athlete_id = e.athlete_id and re.released_on is null) then
      raise exception 'Du kannst nur Athleten aus deinem Kader aufstellen.';
    end if;
    if not coalesce(_slot_ok(e.slot, e.athlete_id), false) then
      raise exception '% passt nicht auf die Position %.', _rname(e.athlete_id), e.slot;
    end if;
  end loop;
  delete from lineups where matchday_id = p_matchday and manager_id = v_me;
  insert into lineups (matchday_id, manager_id, athlete_id, slot) select p_matchday, v_me, athlete_id, slot from _lu;
  drop table _lu;
end $$;

-- Wechsel im Kader: abgegebenen Athleten in Aufstellungen ab p_from ersetzen, wenn der neue auf die
-- Position passt; sonst bleibt die Position leer.
create or replace function _lineup_swap(p_league uuid, p_manager uuid, p_drop text, p_add text, p_from date) returns void
language sql security definer set search_path = public as $$
  update lineups x set athlete_id = p_add
    from matchdays m
   where m.id = x.matchday_id and m.league_id = p_league and m.starts_on >= p_from
     and x.manager_id = p_manager and x.athlete_id = p_drop and p_add is not null
     and coalesce(_slot_ok(x.slot, p_add), false)
     and not exists (select 1 from lineups y where y.matchday_id = x.matchday_id and y.manager_id = x.manager_id and y.athlete_id = p_add);
  delete from lineups x using matchdays m
   where m.id = x.matchday_id and m.league_id = p_league and m.starts_on >= p_from
     and x.manager_id = p_manager and x.athlete_id = p_drop;
$$;
