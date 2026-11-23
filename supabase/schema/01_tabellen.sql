-- =====================================================================
-- Fantasy Athletics – Datenbankschema für Supabase: Tabellen
--
-- Das Schema ist nach Themen auf supabase/schema/NN_*.sql verteilt und wird in Dateireihenfolge
-- eingespielt (Workflow „Datenbank einrichten“, Tests). Alles ist wiederholbar: Tabellen werden nur
-- angelegt, wenn sie fehlen; Funktionen und Regeln werden ersetzt.
-- Alle Schreibzugriffe der App laufen über Datenbankfunktionen (RPC); direkt schreiben darf nur der
-- Service-Key (GitHub-Workflows).
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Umbenennung (November 2026): alte Namen aus UCI Fantasy (riders, races, pcs_slug, uci_…) auf die
-- gemeinsamen Namen beider Apps (athletes, competitions, id, …). Läuft nur, solange die alten Namen
-- noch existieren; Daten bleiben erhalten. In beiden Apps gleich.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  if to_regclass('public.riders') is not null and to_regclass('public.athletes') is null then
    alter table public.riders rename to athletes;
  end if;
  if to_regclass('public.races') is not null and to_regclass('public.competitions') is null then
    alter table public.races rename to competitions;
  end if;
  if to_regclass('public.rider_season_stats') is not null and to_regclass('public.athlete_season_stats') is null then
    alter table public.rider_season_stats rename to athlete_season_stats;
  end if;
  for r in
    select c.table_name, c.column_name, v.new_name
      from information_schema.columns c
      join (values ('athletes', 'pcs_slug', 'id'), ('athletes', 'uci_rank', 'pool_rank'),
                   ('competitions', 'pcs_slug', 'id'), ('competitions', 'uci_class', 'category'),
                   ('results', 'uci_points', 'points'), ('athlete_season_stats', 'riders', 'athletes'),
                   ('event_results', 'uci_points', 'points'), ('event_results', 'rider_name', 'athlete_name'),
                   ('draft_state', 'current_rider', 'current_athlete'),
                   ('waiver_claims', 'add_rider', 'add_athlete'), ('waiver_claims', 'drop_rider', 'drop_athlete'),
                   ('trades', 'give_riders', 'give_athletes'), ('trades', 'take_riders', 'take_athletes'),
                   (null, 'rider_slug', 'athlete_id'), (null, 'race_slug', 'competition_id')) v(tbl, old_name, new_name)
        on c.column_name = v.old_name and (v.tbl is null or c.table_name = v.tbl)
     where c.table_schema = 'public'
       and not exists (select 1 from information_schema.columns x
                        where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = v.new_name)
  loop
    execute format('alter table public.%I rename column %I to %I', r.table_name, r.column_name, r.new_name);
  end loop;
  for r in select * from (values ('riders_gender_rank', 'athletes_gender_rank'), ('riders_norm_name', 'athletes_norm_name'),
                                 ('results_rider_date', 'results_athlete_date'), ('roster_active_rider', 'roster_active_athlete'),
                                 ('races_dataride', 'competitions_dataride'), ('race_events_race', 'race_events_competition'),
                                 ('event_results_rider', 'event_results_athlete')) v(o, n)
            where to_regclass('public.' || o) is not null and to_regclass('public.' || n) is null loop
    execute format('alter index public.%I rename to %I', r.o, r.n);
  end loop;
  -- automatisch benannte Schlüssel und Fremdschlüssel wie bei einer frischen Datenbank benennen
  for r in select c.conrelid::regclass tbl, c.conname, new_name from (
             select x.*, regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                      regexp_replace(regexp_replace(x.conname,
                      '^rider_season_stats_', 'athlete_season_stats_'), '^riders_', 'athletes_'), '^races_', 'competitions_'),
                      'rider_slug', 'athlete_id', 'g'), 'race_slug', 'competition_id', 'g'), 'current_rider', 'current_athlete', 'g'),
                      'add_rider', 'add_athlete', 'g'), 'drop_rider', 'drop_athlete', 'g'), 'pcs_slug', 'id', 'g') new_name
               from pg_constraint x where x.connamespace = 'public'::regnamespace) c
            where c.new_name <> c.conname
              and not exists (select 1 from pg_constraint y where y.connamespace = 'public'::regnamespace and y.conname = c.new_name) loop
    execute format('alter table %s rename constraint %I to %I', r.tbl, r.conname, r.new_name);
  end loop;
  -- Funktionen mit alten Namen entfernen (die neuen werden unten angelegt)
  for r in select p.oid::regprocedure fn from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname in ('rider_points', 'rider_group', 'rider_season_rank', '_rider_free', 'rider_points_recent')
                   -- Ergebnis-Spalten mit alten Namen lassen sich nicht per "create or replace" ändern
                   or p.proargnames && array['rider_slug', 'race_slug', 'uci_points', 'uci_rank', 'uci_class', 'pcs_slug',
                                             'riders', 'current_rider', 'add_rider', 'drop_rider', 'give_riders', 'take_riders', 'rider_name']) loop
    execute format('drop function %s', r.fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Stammdaten aus World Athletics (global, für alle Ligen gleich)
-- ---------------------------------------------------------------------

-- Athleten: alle, die je im Pool waren (DE-Toplisten über der Pool-Schwelle)
create table if not exists athletes (
  id       text primary key,              -- stabile ID: 'wa-<World-Athletics-ID>'
  name           text not null,
  gender         text not null check (gender in ('men', 'women')),
  nation         text,
  team           text,                          -- (bei Leichtathletik ungenutzt)
  pool_rank       int,                           -- Platz im aktuellen Pool nach bester WA-Punktzahl; null = nicht im Pool
  ranking_points numeric,                       -- beste WA-Punktzahl in den Pool-Toplisten
  inactive       boolean not null default false, -- Karriereende / Sperre
  updated_at     timestamptz not null default now()
);
alter table athletes add column if not exists ranking_points numeric;
alter table athletes add column if not exists inactive boolean not null default false;
alter table athletes add column if not exists birth_date date;
alter table athletes add column if not exists wa_id bigint;
alter table athletes add column if not exists event_group text;      -- 800, 1500, 5000, 10000, Marathon, Hindernis (aus der besten Toplistenleistung)
alter table athletes add column if not exists group_override text;   -- vom Betreiber gesetzte Gruppe (hat Vorrang)
alter table athletes add column if not exists group_points numeric;  -- Fantasy-Punkte im Bezugsjahr (Vorjahr des Spieljahrs), Grundlage für Gruppe und Pool-Rang
alter table athletes add column if not exists group_basis text;      -- wie die Gruppe bestimmt wurde (für die Anzeige)
alter table athletes add column if not exists best_discipline text;
alter table athletes add column if not exists best_mark text;
alter table athletes add column if not exists best_year int;
-- beste Leistung der letzten 12 Monate (Anzeige in den Listen; refresh_pool)
alter table athletes add column if not exists recent_discipline text;
alter table athletes add column if not exists recent_mark text;
alter table athletes add column if not exists recent_score int;
create index if not exists athletes_gender_rank on athletes (gender, pool_rank);

-- Toplisten-Einträge (DE, Senioren, alle Disziplinen) – Grundlage für den Pool
create table if not exists toplist_entries (
  athlete_id text not null references athletes (id) on delete cascade,
  year       int  not null,
  discipline text not null,
  mark       text,
  score      int  not null,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, year, discipline)
);

-- Von Hand hinzugefügte Athleten (Admin): immer im Pool, auch ohne Toplisteneintrag über der Schwelle
alter table athletes add column if not exists manual boolean not null default false;
-- Nation laut WA-Profil (täglich aus importer/sync-pbs.ts); neue Athleten aus der DE-Topliste starten als GER.
-- Wer für ein anderes Land startet (z. B. nach Nationenwechsel), fällt aus dem Pool (außer von Hand hinzugefügt).
alter table athletes alter column nation set default 'GER';
-- Aufträge „Athlet hinzufügen“ (Admin → Athleten): WA-ID, Profil-Link oder Name; erledigt der Ablauf add-athlete.yml
create table if not exists athlete_requests (
  id         bigint generated always as identity primary key,
  query      text not null,
  gender     text not null check (gender in ('men', 'women')),
  status     text not null default 'offen' check (status in ('offen', 'läuft', 'fertig', 'mehrdeutig', 'fehler')),
  message    text,
  athlete_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
-- Geschlecht kommt von World Athletics (nicht mehr von Hand)
alter table athlete_requests alter column gender drop not null;

-- Persönliche Bestleistungen laut World Athletics (Profil) und die beste Leistung vor 2025 je Disziplin
-- (Grundlage für den PB-Bonus; ab 2025 kennt die App alle Ergebnisse selbst). Füllt importer/sync-pbs.ts.
create table if not exists athlete_pbs (
  athlete_id   text not null references athletes (id) on delete cascade,
  discipline   text not null,
  mark         text not null,
  date         date,
  result_score int,
  venue        text,
  updated_at   timestamptz not null default now(),
  primary key (athlete_id, discipline)
);
create table if not exists athlete_pb_before (
  athlete_id text not null references athletes (id) on delete cascade,
  discipline text not null,
  mark       text not null,
  date       date,
  primary key (athlete_id, discipline)
);

-- Disziplinen: eigener Faktor, Gruppe für Positionen, WA-Platzierungstabellen (Werte: reference_data.sql)
create table if not exists disciplines (
  name           text primary key,             -- wie bei World Athletics, z. B. '1500 Metres'
  factor         numeric not null default 1,
  event_group    text,
  placing_tables text[] not null default '{}',
  cross_table    text                           -- Cross: Punkte nach Platz statt Leistungspunkten
);
alter table disciplines add column if not exists higher_better boolean not null default false;   -- Sprung, Wurf, Mehrkampf: mehr ist besser

-- Platzierungspunkte nach den WA-World-Ranking-Regeln 2026
--   race_type F = Finale, P9/P10 = letzte Runde vor dem Finale (Finale mit max. 9 / mit 10+ Athleten),
--   place 0 = für das Finale qualifiziert (Q oder q)
create table if not exists placing_scores (
  placing_table text not null,
  category      text not null,
  race_type     text not null check (race_type in ('F', 'P9', 'P10')),
  place         int  not null check (place >= 0),
  points        int  not null,
  primary key (placing_table, category, race_type, place)
);

-- Wertungsparameter (für alle Ligen gleich)
create table if not exists scoring_config (
  id              int primary key default 1 check (id = 1),
  pool_threshold  int     not null default 1000,  -- Pool: WA-Punkte in der DE-Topliste (Jahr oder Vorjahr) mindestens
  perf_threshold  int     not null default 1000,  -- Leistungspunkte = max(0, WA-Punkte − Schwelle) × Faktor
  perf_factor     numeric not null default 0.1,   -- 0,1 = gleiche Größenordnung wie im alten Spiel (AppSheet)
  placing_factor  numeric not null default 0.1,   -- Platzierungspunkte = Tabellenwert × Faktor
  cross_factor    numeric not null default 0.1,   -- Cross: max(0, Cross-Tabellenwert − perf_threshold) × Faktor × Distanzfaktor
  updated_at      timestamptz not null default now()
);
alter table scoring_config alter column perf_factor set default 0.1;
alter table scoring_config alter column placing_factor set default 0.1;
alter table scoring_config alter column cross_factor set default 0.1;
alter table scoring_config add column if not exists game_year int;          -- Spieljahr von Hand (sonst ab 1.11. das Folgejahr)
alter table scoring_config add column if not exists new_group_threshold int not null default 975;  -- neue Athleten: erste Leistung ab x WA-Punkten bestimmt die Gruppe
-- Rekord-Bonus (nur der höchste zählt: WR > ER > DR)
alter table scoring_config add column if not exists record_dr int not null default 50;
alter table scoring_config add column if not exists record_er int not null default 80;
alter table scoring_config add column if not exists record_wr int not null default 100;
-- Standard seit 16.11.2026: 50/100/200 (alte Standardwerte 50/80/100 einmalig umstellen)
alter table scoring_config add column if not exists pb_points int not null default 10;   -- Bonus je persönlicher Bestleistung
alter table scoring_config alter column record_er set default 100;
alter table scoring_config alter column record_wr set default 200;
update scoring_config set record_er = 100, record_wr = 200 where record_dr = 50 and record_er = 80 and record_wr = 100;
insert into scoring_config (id) values (1) on conflict do nothing;
-- Pool ab 975 WA-Punkten (seit November 2026, alle Disziplinen); umgestellt in 99_einspielen.sql, spätere Änderungen des Admins bleiben
alter table scoring_config alter column pool_threshold set default 975;


-- Rohdaten der Ergebnisse von World Athletics (ein Eintrag pro Lauf eines Athleten)
create table if not exists wa_results (
  id                bigint generated always as identity primary key,
  athlete_id        text not null references athletes (id) on delete cascade,
  date              date not null,
  competition       text not null default '',
  venue             text,
  discipline        text not null,
  country           text,
  category          text,                       -- WA-Wettkampfkategorie: OW, DF, GW, GL, A–F
  race              text not null default '',   -- gewerteter Lauf: 'F' auch für kombinierte Finals
  place             int,                        -- gewerteter Platz (bei geteilten Finals kombiniert)
  wa_race           text not null default '',   -- Lauf laut WA (F, F1, SF2, H3 …)
  wa_place          int,
  placing_round     text check (placing_round in ('F', 'P9', 'P10')),   -- Vorrunden-Wertung (vom Importer)
  placing_place     int,                        -- 0 = Q/q, sonst Gesamtplatz der Runde
  mark              text,
  result_score      int,                        -- WA-Punkte der Leistung
  remark            text,
  wa_competition_id bigint,
  wa_event_id       bigint,
  imported_at       timestamptz not null default now(),
  unique (athlete_id, date, discipline, wa_race, competition)
);
-- Herkunft: 'wa' = vom Importer, 'manual' = vom Admin nachgetragen (z. B. aus RaceResult), mit Link als Quelle
alter table wa_results add column if not exists source text not null default 'wa';
alter table wa_results add column if not exists source_url text;
alter table wa_results add column if not exists added_by uuid;
-- Staffel-Nachträge: je Läufer eine Zeile mit der Teilstrecke (z. B. 800 Metres bei 3x800), Anteil 1/3 bzw. 1/4 der Punkte
alter table wa_results add column if not exists relay text;
alter table wa_results add column if not exists share numeric;
-- Meisterschaftsplatz, wenn die Meisterschaft in ein offenes Rennen eingebettet ist (vom Admin; der Importer lässt es stehen)
alter table wa_results add column if not exists champ_place int;
alter table wa_results add column if not exists champ_category text;
-- Rekord laut Admin: DR (deutscher), ER (Europa-), WR (Weltrekord); der Importer lässt die Spalte unverändert
alter table wa_results add column if not exists record text;
do $$ begin
  alter table wa_results add constraint wa_results_record_check check (record in ('DR', 'ER', 'WR'));
exception when duplicate_object then null; end $$;
-- eingestellte Rekorde (=DR, =ER, =WR) zählen halb
alter table wa_results drop constraint if exists wa_results_record_check;
alter table wa_results add constraint wa_results_record_check check (record in ('DR', 'ER', 'WR', '=DR', '=ER', '=WR'));
-- Rangfolge: höherer Rekord ersetzt niedrigeren, eingestellter zählt weniger als neuer
create or replace function _record_rank(p text) returns int language sql immutable as $$
  select coalesce(array_position(array['=DR', 'DR', '=ER', 'ER', '=WR', 'WR'], p), 0);
$$;
do $$ begin
  alter table wa_results add constraint wa_results_source_check check (source in ('wa', 'manual'));
exception when duplicate_object then null; end $$;

-- WA-Punktetabellen nachgebaut: Punkte = a·t² + b·t + c (t = Zeit in Sekunden), je Disziplin und Geschlecht
-- offizielle WA-Punktetabellen (Scoring Tables, research/wa_scoring.txt → reference_data.sql): Punkte = a·x² + b·x + c,
-- x = Sekunden bzw. Meter/Punkte; haben Vorrang vor den geschätzten scoring_coefficients
create table if not exists wa_scoring_tables (
  discipline text not null,
  gender     text not null check (gender in ('men', 'women')),
  a          numeric not null,
  b          numeric not null,
  c          numeric not null,
  x_min      numeric,                 -- Bereich der Tabelle
  x_max      numeric,
  primary key (discipline, gender)
);

-- aus den vorhandenen WA-Ergebnissen berechnet (fit_scoring_coefficients) – für Nachträge ohne WA-Punkte
create table if not exists scoring_coefficients (
  discipline text not null,
  gender     text not null check (gender in ('men', 'women')),
  a          numeric not null,
  b          numeric not null,
  c          numeric not null,
  t_min      numeric,                 -- Zeitbereich der Daten
  t_max      numeric,
  n          int not null,            -- verwendete Ergebnisse
  exact      numeric,                 -- Anteil exakt getroffener WA-Punkte
  max_error  int,                     -- größte Abweichung in Punkten
  fitted_at  timestamptz not null default now(),
  primary key (discipline, gender)
);
create index if not exists wa_results_date on wa_results (date);

-- Wettkämpfe (aus den Ergebnissen der Pool-Athleten): id = 'wa-c<WA-Wettkampf-ID>'
create table if not exists competitions (
  id   text primary key,
  name       text,
  gender     text,
  start_date date,
  end_date   date
);
alter table competitions add column if not exists category text;   -- WA-Kategorie (OW, GW, GL, A …)
alter table competitions add column if not exists country text;     -- IOC-Code
alter table competitions add column if not exists venue text;
alter table competitions add column if not exists loaded_at timestamptz;

-- Wertung: ein Eintrag pro gewertetem Ergebnis mit den Fantasy-Punkten (aus wa_results, siehe rebuild_results)
create table if not exists results (
  id          bigint generated always as identity primary key,
  athlete_id  text not null references athletes (id) on delete cascade,
  competition_id   text not null,
  label       text not null,                    -- Disziplin und Lauf, z. B. '1500 Metres · SF1'
  result_date date not null,
  rank        int,
  points  numeric not null default 0,         -- Fantasy-Punkte (Name aus UCI Fantasy)
  updated_at  timestamptz not null default now(),
  unique (athlete_id, competition_id, label)
);
alter table results add column if not exists updated_at timestamptz not null default now();
alter table results add column if not exists perf_points numeric not null default 0;     -- Leistungsanteil
alter table results add column if not exists placing_points numeric not null default 0;  -- Platzierungsanteil
alter table results add column if not exists wa_result_id bigint;
alter table results add column if not exists record_points numeric not null default 0;
alter table results add column if not exists pb_points numeric not null default 0;          -- PB-Bonus          -- Rekord-Bonus                        -- Quelle in wa_results
create index if not exists results_athlete_date on results (athlete_id, result_date);

create table if not exists sync_status (
  id       int primary key default 1 check (id = 1),
  last_run timestamptz,
  ok       boolean,
  message  text
);
insert into sync_status (id) values (1) on conflict do nothing;

-- Wettkampfkalender (kommende Wettkämpfe mit Laufdisziplinen, aus dem WA-Kalender; importer/sync-calendar.ts):
-- international ab Gold Label, Europa ab Kategorie A, Deutschland ab Kategorie E
create table if not exists calendar_events (
  id          bigint primary key,           -- WA-Wettkampf-ID
  name        text not null,
  venue       text,
  country     text,                         -- IOC-Code
  category    text,                         -- WA-Kategorie (OW, DF, GW, GL, A–F)
  kinds       text[] not null default '{}', -- track, road, cross
  competition_group text,                   -- z. B. „Wanda Diamond League“
  start_date  date not null,
  end_date    date,
  updated_at  timestamptz not null default now()
);
create index if not exists calendar_events_start on calendar_events (start_date);
alter table calendar_events add column if not exists events jsonb;              -- Disziplinen für Erwachsene laut Programm: [{gender, events[]}]
alter table calendar_events add column if not exists areas text[];             -- Bereiche (Lauf, Sprint, …); null = unbekannt
alter table calendar_events add column if not exists events_checked_at timestamptz;

-- Termine aus anderen Quellen (z. B. DLV-Terminliste), solange sie nicht im WA-Kalender stehen.
-- Einmalig von Hand recherchiert und hier eingetragen; steht der Wettkampf später bei WA, gilt WA.
create table if not exists extra_calendar_events (
  name       text not null,              -- wie im WA-Kalender, z. B. „Deutsche Meisterschaften“
  start_date date not null,
  end_date   date,
  venue      text,
  source_url text not null,
  primary key (name, start_date)
);
insert into extra_calendar_events (name, start_date, end_date, venue, source_url) values
  ('Deutsche Hallenmeisterschaften', '2027-02-19', '2027-02-21', null,
   'https://www.leichtathletik.de/fileadmin/user_upload/002_Wettkaempfe/06_Service/04_DM-Bewerbung/Termine_Deutsche_Meisterschaften_2027.pdf'),
  ('Deutsche Meisterschaften', '2027-07-31', '2027-08-01', null,
   'https://www.leichtathletik.de/fileadmin/user_upload/002_Wettkaempfe/06_Service/04_DM-Bewerbung/Termine_Deutsche_Meisterschaften_2027.pdf')
on conflict (name, start_date) do update set end_date = excluded.end_date, venue = excluded.venue, source_url = excluded.source_url;

-- Ergebnisabruf: wann wurden die Ergebnisse eines Athleten für ein Jahr zuletzt komplett geladen?
create table if not exists athlete_sync (
  athlete_id text not null references athletes (id) on delete cascade,
  year       int  not null,
  checked_at timestamptz not null default now(),
  primary key (athlete_id, year)
);

-- Ergebnisabruf: Stand des WA-Sammelabrufs (neueste Ergebnisse der letzten ~30 Tage) je Athlet.
-- Taucht ein unbekanntes Ergebnis auf (neu, nachgereichte Disziplin, geänderte Zeit), wird der Athlet neu geladen.
create table if not exists athlete_feed (
  athlete_id text primary key references athletes (id) on delete cascade,
  keys       text[] not null default '{}',
  changed_at timestamptz not null default now()
);
drop table if exists wa_watch;

-- ---------------------------------------------------------------------
-- Ligen und Manager
-- ---------------------------------------------------------------------

create table if not exists leagues (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  admin_user      uuid not null references auth.users (id),
  invite_code     text not null unique default encode(gen_random_bytes(5), 'hex'),
  max_managers    int  not null default 8   check (max_managers between 2 and 20),
  roster_size     int  not null default 11  check (roster_size between 5 and 30),
  scoring_mode    text not null default 'lineup' check (scoring_mode in ('full', 'lineup')),
  lineup_size     int  check (lineup_size is null or lineup_size between 1 and roster_size),
  budget          int  not null default 100 check (budget = 100),
  min_bid         int  not null default 1   check (min_bid = 1),
  max_per_team    int  check (max_per_team is null or max_per_team between 1 and roster_size),
  draft_mode      text not null default 'live' check (draft_mode in ('live', 'blind', 'snake', 'offline')),
  draft_order     text not null default 'ranking' check (draft_order in ('ranking', 'nominate')),
  bid_seconds     int  not null default 15  check (bid_seconds between 5 and 600),  -- Sekunden pro Gebot bzw. Pick
  waiver_mode     text not null default 'priority' check (waiver_mode in ('priority', 'faab')),
  gender          text not null default 'mixed',
  season_start    date not null,
  season_end      date not null,
  status          text not null default 'setup' check (status in ('setup', 'drafting', 'active', 'finished')),
  last_waiver_run timestamptz,
  draft_at        timestamptz,                -- geplanter Draft-Start
  created_at      timestamptz not null default now(),
  check (season_end > season_start)
);

alter table leagues add column if not exists draft_at timestamptz;
-- Transfers: nur Waiver (Stichtag = Sperre) oder zweiteilig: Waiver-Runde, danach freie Phase bis zum Spieltagstart
alter table leagues add column if not exists transfer_mode text not null default 'waiver_free';
do $$ begin
  alter table leagues add constraint leagues_transfer_mode_check check (transfer_mode in ('waiver', 'waiver_free'));
exception when duplicate_object then null; end $$;
alter table leagues add column if not exists prev_league uuid references leagues (id) on delete set null;  -- Vorsaison
alter table leagues add column if not exists keeper_count int not null default 0;      -- Fahrer, die man behalten darf
alter table leagues add column if not exists keeper_surcharge int not null default 5;  -- Aufschlag auf den Vorjahrespreis
do $$ begin
  alter table leagues add constraint leagues_keeper_check check (keeper_count between 0 and 10 and keeper_surcharge between 0 and 50);
exception when duplicate_object then null; end $$;

-- Leichtathletik: Wertung Männer, Frauen oder Mixed; Aufstellung mit festen Positionen je Disziplingruppe.
--   lineup_mode 'free': jede Position mit Mann oder Frau (bei Männer/Frauen-Ligen immer so)
--   lineup_mode 'mf':   (nur Mixed) je Disziplin eine Position für einen Mann und eine für eine Frau
--   Wildcards nehmen Athleten jeder Gruppe (und jedes Geschlechts).
alter table leagues add column if not exists lineup_mode text not null default 'free';
alter table leagues add column if not exists lineup_groups text[] not null default array['800', '1500', '5000', '10000', 'Marathon', 'Hindernis'];
alter table leagues add column if not exists wildcards int not null default 2;
-- Bereiche, die die Liga spielt (Lauf, Sprint, Hürden, Sprung, Wurf, Mehrkampf, Gehen): nur Athleten mit Schwerpunkt-Disziplin
-- darin können geholt werden; von ihnen zählen alle Ergebnisse
alter table leagues add column if not exists areas text[] not null default array['Lauf'];
do $$ begin
  alter table leagues drop constraint if exists leagues_gender_check;
  alter table leagues add constraint leagues_gender_check check (gender in ('men', 'women', 'mixed'));
  alter table leagues drop constraint if exists leagues_lineup_mode_check;
  alter table leagues add constraint leagues_lineup_mode_check check (lineup_mode in ('free', 'mf') and (lineup_mode = 'free' or gender = 'mixed'));
  alter table leagues drop constraint if exists leagues_wildcards_check;
  alter table leagues add constraint leagues_wildcards_check check (wildcards between 0 and 6);
end $$;

create table if not exists managers (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,  -- null = Platzhalter
  team_name      text not null,
  budget_left    int  not null default 100,
  draft_position int,
  joined_at      timestamptz not null default now(),
  unique (league_id, user_id),
  unique (league_id, team_name)
);

-- ---------------------------------------------------------------------
-- Draft
-- ---------------------------------------------------------------------

alter table managers add column if not exists prev_manager uuid references managers (id) on delete set null;

-- Keeper: aus der Vorsaison behaltene Fahrer (werden beim Draft-Start in den Kader gesetzt)
create table if not exists keepers (
  league_id  uuid not null references leagues (id) on delete cascade,
  manager_id uuid not null references managers (id) on delete cascade,
  athlete_id text not null references athletes (id),
  price      int  not null default 0,
  primary key (manager_id, athlete_id),
  unique (league_id, athlete_id)
);

create table if not exists draft_state (
  league_id        uuid primary key references leagues (id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'running', 'paused', 'done')),
  phase            text not null default 'auction' check (phase in ('auction', 'fill', 'snake')),
  lot_no           int  not null default 0,
  current_athlete    text references athletes (id),
  current_bid      int  not null default 0,
  current_bidder   uuid references managers (id) on delete set null,
  deadline         timestamptz,
  paused_remaining interval,
  nominator        uuid references managers (id) on delete set null,
  updated_at       timestamptz not null default now()
);

-- Snake-Draft nachrüsten (bestehende Datenbanken)
do $$
begin
  alter table leagues drop constraint if exists leagues_draft_mode_check;
  alter table leagues add constraint leagues_draft_mode_check check (draft_mode in ('live', 'blind', 'snake', 'offline'));
  alter table leagues drop constraint if exists leagues_bid_seconds_check;
  alter table leagues add constraint leagues_bid_seconds_check check (bid_seconds between 5 and 600);
  alter table draft_state drop constraint if exists draft_state_phase_check;
  alter table draft_state add constraint draft_state_phase_check check (phase in ('auction', 'fill', 'snake', 'tiebreak'));
end $$;

-- Blind-Auktion: verdeckte Gebote je Fahrer; bei Gleichstand Stechen (+1) unter den Gleichauf-Bietern
alter table draft_state add column if not exists sealed_done uuid[] not null default '{}';  -- wer schon geboten hat (ohne Betrag)
alter table draft_state add column if not exists tie_bidders uuid[];                      -- Teilnehmer am Stechen
alter table draft_state add column if not exists tie_ptr int not null default 0;          -- reihum: Draft-Position des letzten Vorrangs
create table if not exists draft_sealed (
  league_id  uuid not null references leagues (id) on delete cascade,
  lot_no     int  not null,
  manager_id uuid not null references managers (id) on delete cascade,
  amount     int  not null check (amount > 0),
  created_at timestamptz not null default now(),
  primary key (league_id, manager_id)
);

create table if not exists draft_lots (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references leagues (id) on delete cascade,
  lot_no     int  not null,
  athlete_id text not null references athletes (id),
  manager_id uuid references managers (id) on delete set null,  -- null = übersprungen
  price      int  not null default 0,
  created_at timestamptz not null default now(),
  unique (league_id, athlete_id)
);

create table if not exists draft_bids (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references leagues (id) on delete cascade,
  lot_no     int  not null,
  manager_id uuid not null references managers (id) on delete cascade,
  amount     int  not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Kader
-- Ein Eintrag pro Zugehörigkeit. Ergebnisse zählen ab acquired_on
-- (einschließlich) bis released_on (ausschließlich).
-- ---------------------------------------------------------------------

create table if not exists roster_entries (
  id          bigint generated always as identity primary key,
  league_id   uuid not null references leagues (id) on delete cascade,
  manager_id  uuid not null references managers (id) on delete cascade,
  athlete_id  text not null references athletes (id),
  price       int  not null default 0,
  source      text not null,
  acquired_on date not null,
  acquired_at timestamptz not null default now(),
  released_on date,
  released_at timestamptz
);
alter table roster_entries drop constraint if exists roster_entries_source_check;
alter table roster_entries add constraint roster_entries_source_check
  check (source in ('draft', 'offline', 'waiver', 'trade', 'admin', 'free'));
create unique index if not exists roster_active_athlete on roster_entries (league_id, athlete_id) where released_on is null;
create index if not exists roster_manager on roster_entries (manager_id);

-- ---------------------------------------------------------------------
-- Spieltage, Aufstellungen
-- ---------------------------------------------------------------------

create table if not exists matchdays (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references leagues (id) on delete cascade,
  name         text not null,
  starts_on    date not null,
  ends_on      date not null,
  deadline     timestamptz not null,           -- Stichtag für Kaderänderungen
  status       text not null default 'planned' check (status in ('planned', 'running', 'closed')),
  waivers_done boolean not null default false,  -- Stichtag abgearbeitet
  closed_at    timestamptz,
  frozen       boolean not null default false,  -- Ergebnis eingefroren (7 Tage nach Abschluss)
  scoring_mode text,                            -- beim Stichtag aus der Liga übernommen
  lineup_size  int,
  check (ends_on >= starts_on),
  constraint matchdays_no_overlap exclude using gist (
    league_id with =, daterange(starts_on, ends_on, '[]') with &&)
);

alter table matchdays add column if not exists waiver_deadline timestamptz;   -- Waiver-Auswertung (null = am Stichtag)
alter table matchdays add column if not exists locked boolean not null default false;   -- Kader/Aufstellung fest (Stichtag erreicht)
update matchdays set locked = true where not locked and waivers_done and deadline <= now();

create table if not exists lineups (
  matchday_id uuid not null references matchdays (id) on delete cascade,
  manager_id  uuid not null references managers (id) on delete cascade,
  athlete_id  text not null references athletes (id),
  primary key (matchday_id, manager_id, athlete_id)
);
-- Position in der Aufstellung, z. B. '1500', '800:W' (Mixed je Disziplin m+w), 'WC1'
alter table lineups add column if not exists slot text not null default '';
create unique index if not exists lineups_slot on lineups (matchday_id, manager_id, slot);

-- ---------------------------------------------------------------------
-- Waiver und Tausch
-- ---------------------------------------------------------------------

create table if not exists waiver_claims (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references leagues (id) on delete cascade,
  manager_id   uuid not null references managers (id) on delete cascade,
  add_athlete    text not null references athletes (id),
  drop_athlete   text not null references athletes (id),
  priority     int  not null default 1,
  bid          int  not null default 0,
  status       text not null default 'pending' check (status in ('pending', 'won', 'lost', 'cancelled')),
  note         text,
  matchday_id  uuid references matchdays (id) on delete set null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists trades (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references leagues (id) on delete cascade,
  from_manager uuid not null references managers (id) on delete cascade,
  to_manager   uuid not null references managers (id) on delete cascade,
  give_athletes  text[] not null,   -- gibt from_manager ab
  take_athletes  text[] not null,   -- bekommt from_manager
  status       text not null default 'proposed'
               check (status in ('proposed', 'accepted', 'declined', 'cancelled', 'vetoed', 'done', 'failed')),
  note         text,
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  done_at      timestamptz
);
-- Waiver ohne Abgabe, wenn der Kader nicht voll ist (z. B. nach einem ungleichen Tausch)
alter table waiver_claims alter column drop_athlete drop not null;

-- Ungleiche Tausche: wer mehr Fahrer bekommt, entlässt dafür zusätzlich eigene Fahrer
alter table trades add column if not exists from_drop text[] not null default '{}';   -- entlässt from_manager (beim Angebot gewählt)
alter table trades add column if not exists to_drop   text[] not null default '{}';   -- entlässt to_manager (bei Annahme gewählt)

-- ---------------------------------------------------------------------
-- Punkte: Korrekturen, eingefrorene Stände, Protokoll
-- ---------------------------------------------------------------------

create table if not exists point_overrides (
  id          bigint generated always as identity primary key,
  league_id   uuid not null references leagues (id) on delete cascade,
  matchday_id uuid not null references matchdays (id) on delete cascade,
  manager_id  uuid not null references managers (id) on delete cascade,
  athlete_id  text not null references athletes (id),
  points      numeric not null,
  reason      text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (matchday_id, manager_id, athlete_id)
);

create table if not exists score_snapshot (
  league_id   uuid not null references leagues (id) on delete cascade,
  matchday_id uuid not null references matchdays (id) on delete cascade,
  manager_id  uuid not null references managers (id) on delete cascade,
  athlete_id  text not null,
  competition_id   text not null,
  label       text not null,
  result_date date not null,
  points      numeric not null
);
create index if not exists score_snapshot_md on score_snapshot (matchday_id);

create table if not exists admin_log (
  id         bigint generated always as identity primary key,
  league_id  uuid not null references leagues (id) on delete cascade,
  user_id    uuid,
  action     text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Push-Benachrichtigungen
-- ---------------------------------------------------------------------

-- Interne Einstellungen (z. B. VAPID-Schlüssel) – nur für den Service-Key lesbar
create table if not exists app_config (
  key   text primary key,
  value text not null
);

create table if not exists push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Warteschlange: wird alle 15 Minuten vom Workflow "Benachrichtigungen senden" verschickt
create table if not exists notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null,
  body       text,
  url        text,
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
alter table notifications add column if not exists expires_at timestamptz;   -- danach nicht mehr senden (z. B. „Du bist dran“)
create index if not exists notifications_unsent on notifications (created_at) where sent_at is null;

-- Schon gemeldete Punkte („Neue Punkte“-Push): je Manager, Athlet, Wettkampf und Lauf genau einmal
create table if not exists point_pushes (
  manager_id     uuid not null references managers (id) on delete cascade,
  athlete_id     text not null,
  competition_id text not null,
  label          text not null,
  created_at     timestamptz not null default now(),
  primary key (manager_id, athlete_id, competition_id, label)
);
alter table point_pushes enable row level security;   -- keine Policies: nur intern
