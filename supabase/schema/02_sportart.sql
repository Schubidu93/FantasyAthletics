-- =====================================================================
-- Sportart Leichtathletik: alles, worin sich die Datenbank von UCI Fantasy unterscheidet
-- (Begriffe in Meldungen, Punkteformat, Pool, Disziplingruppen, Positionen). Die übrigen
-- Dateien sind in beiden Apps gleich und nutzen nur diese Funktionen.
-- =====================================================================

-- Begriffe in Meldungen – wie SPORT in web/sport/config.js
create or replace function _word(p_key text) returns text
language sql immutable as $$
  select case p_key when 'one' then 'Athlet' when 'oneAcc' then 'Athleten' when 'many' then 'Athleten'
                    when 'manyDat' then 'Athleten' when 'team' then 'Team' when 'teamGen' then 'Teams'
                    when 'pool' then 'im Athletenpool' when 'importHint' then 'Workflow "Athletenpool laden"'
                    when 'emoji' then '🏃' end;
$$;

-- Punkte in Nachrichten wie in der App: zwei Nachkommastellen mit Komma (z. B. 30,00)
create or replace function _fmt_pts(p numeric) returns text
language sql immutable as $$ select replace(to_char(round(coalesce(p, 0), 2), 'FM999999990.00'), '.', ',') $$;

-- App: GitHub-Repository (Zeitplaner startet dort die Abläufe), Kurzname (Zeitplan, Kennung), längste Pause des Datenabrufs in Stunden
create or replace function _app(p_key text) returns text
language sql immutable as $$
  select case p_key when 'repo' then 'Schubidu93/FantasyAthletics' when 'slug' then 'fantasy-athletics'
                    when 'sync_hours' then '8' end;   -- Datenabruf stündlich 8–23 und 3 Uhr
$$;

-- Nachkommastellen der Punkte (Anzeige, Draft-Prognose)
create or replace function _pts_digits() returns int language sql immutable as $$ select 2 $$;

-- Prognose im Draft-Report: nur Leistungs- und Platzierungspunkte – Bestleistung und Rekord lassen sich nicht wiederholen
create or replace function _projection_points(r results) returns numeric
language sql immutable as $$ select r.points - r.pb_points - r.record_points $$;

-- Datenabruf zur vollen Stunde (deutsche Zeit), aufgerufen vom Zeitplaner
create or replace function _sport_tick(h int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if h = 6 then perform dispatch_workflow('import-athletes.yml'); end if;          -- Athletenpool aus den DE-Toplisten
  -- Ergebnisse: stündlich neue Ergebnisse (Sammelabruf), nachts neue Athleten, Kader und ein Siebtel des Pools komplett
  if h between 8 and 23 then perform dispatch_workflow('import-results.yml', '{"modus": "neu"}'); end if;
  if h = 3 then perform dispatch_workflow('import-results.yml', '{"modus": "nacht"}'); end if;
end $$;

-- Leistung als Zahl: Zeiten in Sekunden ("2:04:45" → 7485), Weiten/Höhen/Punkte als Zahl ("8.29" → 8.29)
create or replace function mark_seconds(p text) returns numeric
language plpgsql immutable as $$
declare v text := replace(regexp_replace(coalesce(p, ''), '[^0-9:.,]', '', 'g'), ',', '.'); parts text[]; t numeric := 0; x text;
begin
  if v !~ '^\d+(:\d{1,2})*(\.\d+)?$' then return null; end if;
  parts := string_to_array(v, ':');
  if cardinality(parts) > 3 then return null; end if;
  foreach x in array parts loop t := t * 60 + x::numeric; end loop;
  return t;
end $$;

-- Vergleichswert einer Leistung: kleiner = besser (Zeiten direkt; Sprung, Wurf und Mehrkampf: mehr ist besser)
create or replace function _mark_cost(p_higher_better boolean, p_mark text) returns numeric
language sql immutable as $$
  select case when coalesce(p_higher_better, false) then -mark_seconds(p_mark) else mark_seconds(p_mark) end;
$$;
create or replace function _mark_cost(p_discipline text, p_mark text) returns numeric
language sql stable as $$
  select _mark_cost((select higher_better from disciplines where name = p_discipline), p_mark);
$$;

-- Bereich einer Disziplingruppe (Schwerpunkt-Disziplin eines Athleten):
--   Lauf: 800, 1500, 5000, 10000, Marathon, Hindernis · Sprint: 100, 200, 400 · Hürden: Kurzhürden, Langhürden
--   Sprung: Hochsprung, Stabhochsprung, Weitsprung, Dreisprung · Wurf: Kugel, Diskus, Hammer, Speer · Mehrkampf · Gehen
create or replace function _group_area(p_group text) returns text
language sql immutable as $$
  select case when p_group in ('800', '1500', '5000', '10000', 'Marathon', 'Hindernis') then 'Lauf'
              when p_group in ('100', '200', '400') then 'Sprint'
              when p_group in ('Kurzhürden', 'Langhürden') then 'Hürden'
              when p_group in ('Hochsprung', 'Stabhochsprung', 'Weitsprung', 'Dreisprung') then 'Sprung'
              when p_group in ('Kugel', 'Diskus', 'Hammer', 'Speer') then 'Wurf'
              when p_group in ('Mehrkampf', 'Gehen') then p_group end;
$$;

-- Positionen der Aufstellung → erlaubte Disziplingruppen. Neben den Gruppen selbst fassen Blöcke mehrere zusammen:
-- „Mittel“ (800/1500), „Lang“ (5000/10.000/Hindernis) und je Bereich Sprint, Hürden, Sprung, Wurf (alle Gruppen des Bereichs).
create or replace function _position_groups(p_position text) returns text[]
language sql immutable as $$
  select case p_position when 'Mittel' then array['800', '1500'] when 'Lang' then array['5000', '10000', 'Hindernis']
              when 'Sprint' then array['100', '200', '400'] when 'Hürden' then array['Kurzhürden', 'Langhürden']
              when 'Sprung' then array['Hochsprung', 'Stabhochsprung', 'Weitsprung', 'Dreisprung']
              when 'Wurf' then array['Kugel', 'Diskus', 'Hammer', 'Speer']
              else array[p_position] end;
$$;

-- Darf der Athlet in dieser Liga geholt werden (Draft, Waiver, freie Phase)? Im Athletenpool und in einem Bereich
-- der Liga (ohne bekannte Gruppe: überall)
drop function if exists _selectable(int);
create or replace function _eligible(l leagues, a athletes) returns boolean
language sql stable as $$
  select a.pool_rank is not null
     and coalesce(_group_area(coalesce(a.group_override, a.event_group)) = any (l.areas), true);
$$;

-- Disziplingruppe (Schwerpunkt-Disziplin) eines Athleten, siehe _group_area
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

-- Darf der Athlet auf diese Position? Gruppe muss zur Position passen (außer Wildcard), bei ":M"/":W" auch das Geschlecht.
create or replace function _slot_ok(p_slot text, p_rider text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when split_part(p_slot, ':', 2) = 'M' and r.gender <> 'men' then false
    when split_part(p_slot, ':', 2) = 'W' and r.gender <> 'women' then false
    when p_slot like 'WC%' then true
    else coalesce(r.group_override, r.event_group) = any (_position_groups(split_part(p_slot, ':', 1))) end
  from athletes r where r.id = p_rider;
$$;

-- Liga-Einstellungen vereinheitlichen: Zahl der Positionen = wertende Athleten
create or replace function _league_defaults() returns trigger
language plpgsql as $$
begin
  if new.gender <> 'mixed' then new.lineup_mode := 'free'; end if;
  new.lineup_groups := coalesce(new.lineup_groups, '{}');
  new.areas := coalesce(new.areas, '{}');
  if cardinality(new.areas) = 0 then raise exception 'Bitte mindestens einen Bereich wählen.'; end if;
  if exists (select 1 from unnest(new.areas) x where x not in ('Lauf', 'Sprint', 'Hürden', 'Sprung', 'Wurf', 'Mehrkampf', 'Gehen')) then
    raise exception 'Unbekannter Bereich.';
  end if;
  -- Jede Position muss zu einem gespielten Bereich gehören
  if exists (select 1 from unnest(new.lineup_groups) p
              where not exists (select 1 from unnest(_position_groups(p)) g where _group_area(g) = any (new.areas))) then
    raise exception 'Jede Position muss zu einem Bereich der Liga gehören.';
  end if;
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
