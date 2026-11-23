-- =====================================================================
-- Nachträge: Ergebnisse, die World Athletics nicht führt (z. B. von RaceResult), mit WA-Punkten
-- =====================================================================

-- "2:09:43" / "29:18" / "13:45.12" / "29:18,4" -> Sekunden
-- Koeffizienten aus allen WA-Ergebnissen mit Zeit und WA-Punkten berechnen (kleinste Quadrate). Ausreißer
-- (z. B. falsch erfasste Zeiten) werden schrittweise aussortiert: weg, was mehr als 3 × die mittlere Abweichung
-- (Median) + 2 Punkte daneben liegt, dann neu rechnen, bis sich nichts mehr ändert. Gibt die Zahl der Tabellen zurück.
create or replace function fit_scoring_coefficients(p_min int default 30) returns int
language plpgsql security definer set search_path = public as $$
declare g record; pass int; s0 numeric; s1 numeric; s2 numeric; s3 numeric; s4 numeric; y0 numeric; y1 numeric; y2 numeric;
        det numeric; ka numeric; kb numeric; kc numeric; n int := 0; lim numeric; dropped int;
begin
  create temp table if not exists _fit (discipline text, gender text, t numeric, y numeric, ok boolean) on commit drop;
  truncate _fit;
  insert into _fit
    select w.discipline, r.gender, mark_seconds(w.mark), w.result_score, true
      from wa_results w join athletes r on r.id = w.athlete_id join disciplines d on d.name = w.discipline
     where w.source = 'wa' and w.result_score > 0 and d.cross_table is null and mark_seconds(w.mark) > 0;
  for g in select discipline, gender from _fit group by 1, 2 having count(*) >= p_min loop
    ka := null; kb := null; kc := null;
    for pass in 1..8 loop
      select count(*), sum(t), sum(t^2), sum(t^3), sum(t^4), sum(y), sum(t*y), sum(t^2*y)
        into s0, s1, s2, s3, s4, y0, y1, y2
        from _fit f where f.discipline = g.discipline and f.gender = g.gender and f.ok;
      if s0 < p_min then ka := null; exit; end if;
      -- Normalgleichungen [s4 s3 s2; s3 s2 s1; s2 s1 s0]·[a b c] = [y2 y1 y0] (Cramersche Regel)
      det := s4*(s2*s0 - s1*s1) - s3*(s3*s0 - s1*s2) + s2*(s3*s1 - s2*s2);
      if det = 0 then ka := null; exit; end if;
      ka := (y2*(s2*s0 - s1*s1) - s3*(y1*s0 - s1*y0) + s2*(y1*s1 - s2*y0)) / det;
      kb := (s4*(y1*s0 - s1*y0) - y2*(s3*s0 - s1*s2) + s2*(s3*y0 - y1*s2)) / det;
      kc := (s4*(s2*y0 - s1*y1) - s3*(s3*y0 - s2*y1) + y2*(s3*s1 - s2*s2)) / det;
      -- Grenze aus allen Ergebnissen der Gruppe (Median ist unempfindlich gegen wenige Ausreißer);
      -- zu Unrecht aussortierte kommen mit der besseren Formel wieder hinein
      select 3 * percentile_cont(0.5) within group (order by abs(ka*t^2 + kb*t + kc - y)) + 2 into lim
        from _fit f where f.discipline = g.discipline and f.gender = g.gender;
      update _fit f set ok = not f.ok where f.discipline = g.discipline and f.gender = g.gender
         and f.ok <> (abs(ka*f.t^2 + kb*f.t + kc - f.y) <= lim);
      get diagnostics dropped = row_count;
      exit when dropped = 0;
    end loop;
    continue when ka is null or ka <= 0;
    insert into scoring_coefficients (discipline, gender, a, b, c, t_min, t_max, n, exact, max_error, fitted_at)
    select g.discipline, g.gender, ka, kb, kc, min(f.t), max(f.t), count(*),
           round(avg((round(ka*f.t^2 + kb*f.t + kc) = f.y)::int), 3), max(abs(round(ka*f.t^2 + kb*f.t + kc) - f.y)), now()
      from _fit f where f.discipline = g.discipline and f.gender = g.gender and f.ok
    on conflict (discipline, gender) do update set a = excluded.a, b = excluded.b, c = excluded.c, t_min = excluded.t_min,
      t_max = excluded.t_max, n = excluded.n, exact = excluded.exact, max_error = excluded.max_error, fitted_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- WA-Punkte einer Zeit (null, wenn es für Disziplin/Geschlecht noch keine Tabelle gibt)
create or replace function wa_points(p_discipline text, p_gender text, p_mark text) returns int
language sql stable security definer set search_path = public as $$
  -- offizielle WA-Tabelle zuerst, sonst die aus WA-Ergebnissen geschätzte Parabel
  with k as (select a, b, c from wa_scoring_tables where discipline = p_discipline and gender = p_gender
             union all
             select a, b, c from scoring_coefficients
              where discipline = p_discipline and gender = p_gender
                and not exists (select 1 from wa_scoring_tables where discipline = p_discipline and gender = p_gender)),
       x as (select mark_seconds(p_mark) v, coalesce((select higher_better from disciplines where name = p_discipline), false) hb)
  select case when x.v is null then null
              -- jenseits des Tiefpunkts der Parabel (zu langsam bzw. zu kurz) gibt es 0 Punkte
              when (not x.hb and x.v >= -k.b / (2 * k.a)) or (x.hb and x.v <= -k.b / (2 * k.a)) then 0
              else greatest(0, round(k.a * x.v^2 + k.b * x.v + k.c))::int end
    from k, x;
$$;

create or replace function _require_any_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from leagues where admin_user = auth.uid()) and not _is_service() then
    raise exception 'Nur Liga-Admins dürfen Ergebnisse nachtragen.';
  end if;
end $$;

-- Vorschau für das Eingabeformular: WA-Punkte, Schwelle, bereits vorhandenes Ergebnis
create or replace function manual_result_check(p_rider text, p_discipline text, p_date date, p_mark text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r athletes; pts int; dup record;
begin
  perform _require_any_admin();
  select * into r from athletes where id = p_rider;
  if r.id is null then raise exception 'Athlet nicht gefunden.'; end if;
  pts := wa_points(p_discipline, r.gender, p_mark);
  select w.date, w.competition, w.mark, w.source into dup from wa_results w
   where w.athlete_id = p_rider and w.discipline = p_discipline and abs(w.date - p_date) <= 1
   order by w.source = 'wa' desc limit 1;
  return jsonb_build_object(
    'seconds', mark_seconds(p_mark),
    'wa_points', pts,
    'has_table', exists (select 1 from scoring_coefficients where discipline = p_discipline and gender = r.gender),
    'threshold', (select perf_threshold from scoring_config where id = 1),
    'duplicate', case when dup.date is null then null
                      else jsonb_build_object('date', dup.date, 'competition', dup.competition, 'mark', dup.mark, 'source', dup.source) end);
end $$;

-- Nachtrag speichern. p: athlete_id, date, discipline, mark, competition, venue, source_url, wa_points (optional,
-- nur wenn die App die Punkte nicht berechnen kann)
create or replace function add_manual_result(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare r athletes; d disciplines; v_date date := (p->>'date')::date; v_mark text := nullif(trim(p->>'mark'), '');
        v_comp text := nullif(trim(p->>'competition'), ''); pts int; v_id bigint; v_slug text;
begin
  perform _require_any_admin();
  select * into r from athletes where id = p->>'athlete_id';
  if r.id is null then raise exception 'Athlet nicht gefunden.'; end if;
  select * into d from disciplines where name = p->>'discipline';
  if d.name is null or coalesce(d.factor, 0) = 0 or d.cross_table is not null then
    raise exception 'Disziplin % kann nicht nachgetragen werden.', p->>'discipline';
  end if;
  if v_date is null or v_date > current_date or v_date < date '2025-01-01' then raise exception 'Ungültiges Datum.'; end if;
  if v_comp is null then raise exception 'Bitte den Wettkampf angeben.'; end if;
  if mark_seconds(v_mark) is null then raise exception 'Zeit nicht erkannt (z. B. 29:18 oder 1:02:45).'; end if;
  if exists (select 1 from wa_results w where w.athlete_id = r.id and w.discipline = d.name and abs(w.date - v_date) <= 1) then
    raise exception 'Für % gibt es in dieser Disziplin um diesen Tag schon ein Ergebnis.', r.name;
  end if;
  pts := coalesce(wa_points(d.name, r.gender, v_mark), (p->>'wa_points')::int);
  if pts is null then raise exception 'WA-Punkte können für diese Disziplin noch nicht berechnet werden – bitte von Hand angeben.'; end if;
  insert into wa_results (athlete_id, date, competition, venue, discipline, race, wa_race, mark, result_score, remark,
                          source, source_url, added_by)
  values (r.id, v_date, v_comp, nullif(trim(p->>'venue'), ''), d.name, 'F', 'F', v_mark, pts, 'Nachtrag',
          'manual', nullif(trim(p->>'source_url'), ''), auth.uid())
  returning id into v_id;
  v_slug := 'wa-' || md5(v_comp || v_date::text);
  insert into competitions (id, name, venue, start_date, end_date, loaded_at)
  values (v_slug, v_comp, nullif(trim(p->>'venue'), ''), v_date, v_date, now())
  on conflict (id) do nothing;
  perform rebuild_results(v_date);
  perform refresh_season_stats(extract(year from v_date)::int);
  return v_id;
end $$;

-- Staffel-Kennung → Teilstrecke und Anzahl Läufer
create or replace function _relay_leg(p_relay text) returns table (discipline text, legs int)
language sql immutable as $$
  select v.d, v.n from (values ('3x800', '800 Metres', 3), ('3x1000', '1000 Metres', 3), ('4x400', '400 Metres', 4)) v(r, d, n)
   where v.r = p_relay;
$$;
-- Zeit als Text (m:ss.cc bzw. h:mm:ss)
create or replace function _fmt_seconds(p numeric) returns text
language sql immutable as $$
  select case when p >= 3600 then to_char(floor(p / 3600), 'FM9') || ':' || to_char(floor(mod(p, 3600) / 60), 'FM00') || ':' || to_char(floor(mod(p, 60)), 'FM00')
              else to_char(floor(p / 60), 'FM99') || ':' || to_char(mod(p, 60), 'FM00.00') end;
$$;

-- Nachtrag anlegen oder ändern (ersetzt dann die Zeilen in replace_ids). p:
--   athlete_ids (1 Athlet, bei Staffeln bis zu 3 bzw. 4), relay ('3x800', '3x1000', '4x400' oder leer), discipline (ohne Staffel),
--   date, mark (Bruttozeit bzw. Staffel-Endzeit), competition, venue, country (Pflicht), category (Standard F), place (optional),
--   source_url, wa_points (nur wenn die App sie nicht berechnen kann), competition_id (vorhandene Nachtrags-Veranstaltung)
create or replace function save_manual_result(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r athletes; d disciplines; v_date date := (p->>'date')::date; v_mark text := nullif(trim(p->>'mark'), '');
        v_comp text := nullif(trim(p->>'competition'), ''); v_country text := upper(nullif(trim(p->>'country'), ''));
        v_cat text := upper(coalesce(nullif(trim(p->>'category'), ''), 'F')); v_place int := nullif(p->>'place', '')::int;
        v_relay text := nullif(p->>'relay', ''); v_disc text := p->>'discipline'; v_legs int := 1; v_secs numeric;
        v_leg text; pts int; v_ids text[]; v_old date; v_slug text := nullif(p->>'competition_id', ''); n int := 0; a text;
        v_venue text := nullif(trim(p->>'venue'), '');
begin
  perform _require_any_admin();
  select array_agg(x) into v_ids from jsonb_array_elements_text(coalesce(p->'athlete_ids', jsonb_build_array(p->>'athlete_id'))) x where x is not null;
  if coalesce(cardinality(v_ids), 0) = 0 then raise exception 'Bitte einen Athleten wählen.'; end if;
  if v_relay is not null then
    select l.discipline, l.legs into v_disc, v_legs from _relay_leg(v_relay) l;
    if v_disc is null then raise exception 'Unbekannte Staffel: %', v_relay; end if;
    if cardinality(v_ids) > v_legs then raise exception 'Höchstens % Läufer.', v_legs; end if;
    -- „6:08:33“ bei Staffeln = 6:08,33 Minuten
    if v_mark ~ '^\d{1,2}:\d{2}:\d{2}$' and split_part(v_mark, ':', 1)::int < 30 then
      v_mark := regexp_replace(v_mark, '^(\d+:\d{2}):(\d{2})$', '\1.\2');
    end if;
  elsif cardinality(v_ids) > 1 then raise exception 'Mehrere Läufer nur bei Staffeln.';
  end if;
  select * into d from disciplines where name = v_disc;
  if d.name is null or coalesce(d.factor, 0) = 0 or d.cross_table is not null then
    raise exception 'Disziplin % kann nicht nachgetragen werden.', v_disc;
  end if;
  if v_date is null or v_date > current_date or v_date < date '2025-01-01' then raise exception 'Ungültiges Datum.'; end if;
  if v_slug is not null then
    select name, coalesce(v_venue, venue), coalesce(v_country, country), coalesce(nullif(p->>'category', ''), category, 'F')
      into v_comp, v_venue, v_country, v_cat from competitions where id = v_slug and id !~ '^wa-c';
    if v_comp is null then raise exception 'Veranstaltung nicht gefunden.'; end if;
  end if;
  if v_comp is null then raise exception 'Bitte den Wettkampf angeben.'; end if;
  if v_country is null or v_country !~ '^[A-Z]{3}$' then raise exception 'Bitte das Land angeben (z. B. GER).'; end if;
  if v_cat not in ('OW', 'DF', 'GW', 'GL', 'A', 'B', 'C', 'D', 'E', 'F') then raise exception 'Unbekannte Kategorie: %', v_cat; end if;
  v_secs := mark_seconds(v_mark);
  if v_secs is null then raise exception 'Zeit nicht erkannt (z. B. 29:18 oder 1:02:45).'; end if;
  v_leg := _fmt_seconds(round(v_secs / v_legs, 2));
  -- Bearbeiten: alte Zeilen entfernen (nur Nachträge)
  if p ? 'replace_ids' then
    select min(date) into v_old from wa_results where id in (select x::bigint from jsonb_array_elements_text(p->'replace_ids') x);
    if exists (select 1 from wa_results where id in (select x::bigint from jsonb_array_elements_text(p->'replace_ids') x) and source <> 'manual') then
      raise exception 'Nur Nachträge können geändert werden.';
    end if;
    delete from wa_results where id in (select x::bigint from jsonb_array_elements_text(p->'replace_ids') x);
  end if;
  foreach a in array v_ids loop
    select * into r from athletes where id = a;
    if r.id is null then raise exception 'Athlet nicht gefunden.'; end if;
    if v_relay is null and exists (select 1 from wa_results w where w.athlete_id = r.id and w.discipline = d.name and w.relay is null
                                     and abs(w.date - v_date) <= 1) then
      raise exception 'Für % gibt es in dieser Disziplin um diesen Tag schon ein Ergebnis.', r.name;
    end if;
    pts := coalesce(wa_points(d.name, r.gender, v_leg), (p->>'wa_points')::int);
    if pts is null then raise exception 'WA-Punkte für % können noch nicht berechnet werden – bitte von Hand angeben.', r.name; end if;
    insert into wa_results (athlete_id, date, competition, venue, country, category, discipline, race, wa_race, place, wa_place,
                            mark, result_score, remark, relay, share, source, source_url, added_by)
    values (r.id, v_date, v_comp, v_venue, v_country, v_cat, d.name, 'F', coalesce('Staffel ' || v_relay, 'F'), v_place, v_place,
            v_mark, pts, case when v_relay is null then 'Nachtrag' else 'Staffel' end, v_relay,
            case when v_relay is null then null else round(1.0 / v_legs, 4) end,
            'manual', nullif(trim(p->>'source_url'), ''), auth.uid());
    n := n + 1;
  end loop;
  v_slug := coalesce(v_slug, 'wa-' || md5(v_comp || v_date::text));
  insert into competitions (id, name, venue, country, category, start_date, end_date, loaded_at)
  values (v_slug, v_comp, v_venue, v_country, v_cat, v_date, v_date, now())
  on conflict (id) do update set start_date = least(competitions.start_date, excluded.start_date),
                                 end_date = greatest(competitions.end_date, excluded.end_date),
                                 country = coalesce(excluded.country, competitions.country),
                                 venue = coalesce(excluded.venue, competitions.venue), category = excluded.category;
  perform rebuild_results(least(v_date, coalesce(v_old, v_date)));
  perform refresh_season_stats(extract(year from v_date)::int);
  if v_old is not null and extract(year from v_old) <> extract(year from v_date) then perform refresh_season_stats(extract(year from v_old)::int); end if;
  return n;
end $$;

-- Veranstaltungen aus Nachträgen (zur Auswahl beim nächsten Nachtrag)
create or replace function manual_competitions()
returns table (id text, name text, venue text, country text, category text, start_date date, end_date date)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.venue, c.country, c.category, c.start_date, c.end_date from competitions c
   where c.id !~ '^wa-c' and exists (select 1 from wa_results w where w.source = 'manual' and 'wa-' || md5(w.competition || w.date::text) = c.id
                                      or (w.source = 'manual' and w.competition = c.name))
   order by c.start_date desc limit 200;
$$;

-- Athlet hinzufügen (Admin): Auftrag anlegen und den Ablauf „Athlet hinzufügen“ starten
create or replace function request_athlete(p_query text, p_gender text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform _require_any_admin();
  if coalesce(trim(p_query), '') = '' then raise exception 'Bitte WA-ID, Profil-Link oder Namen angeben.'; end if;
  if p_gender is not null and p_gender not in ('men', 'women') then raise exception 'Bitte Männer oder Frauen wählen.'; end if;
  insert into athlete_requests (query, gender, created_by) values (trim(p_query), p_gender, auth.uid()) returning id into v_id;
  begin
    perform dispatch_workflow('add-athlete.yml');
  exception when others then
    raise warning 'Ablauf „Athlet hinzufügen“ nicht gestartet: %', sqlerrm;   -- Auftrag bleibt offen (Start per Knopfdruck möglich)
  end;
  return v_id;
end $$;

create or replace function delete_manual_result(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_date date;
begin
  perform _require_any_admin();
  delete from wa_results where id = p_id and source = 'manual' returning date into v_date;
  if v_date is null then raise exception 'Nachtrag nicht gefunden.'; end if;
  perform rebuild_results(v_date);
  perform refresh_season_stats(extract(year from v_date)::int);
end $$;
