-- =====================================================================
-- Fantasy Athletics – Datenbankschema für Supabase
-- (Grundlage: UCI Fantasy, angepasst für Leichtathletik)
--
-- Einmal komplett im Supabase SQL-Editor ausführen (oder per Workflow
-- "Datenbank einrichten"), danach supabase/reference_data.sql. Das Skript ist
-- wiederholbar: Tabellen werden nur angelegt, wenn sie fehlen; Funktionen und
-- Regeln werden ersetzt.
--
-- Alle Schreibzugriffe der App laufen über die Funktionen (RPC) unten.
-- Direkt schreiben darf nur der Service-Key (GitHub-Workflows).
--
-- Namen: Athleten in "athletes" (ID "wa-<World-Athletics-ID>"), Wettkämpfe in
-- "competitions" (ID "wa-c<Wettkampf-ID>"), Fantasy-Punkte je Ergebnis in "results".
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Umbenennung (November 2026): Namen aus UCI Fantasy (riders, races, uci_…) auf
-- Leichtathletik-Namen. Läuft nur, solange die alten Namen noch existieren; Daten bleiben erhalten.
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
                                 ('results_rider_date', 'results_athlete_date'), ('roster_active_rider', 'roster_active_athlete')) v(o, n)
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
              and (p.proname in ('rider_points', 'rider_group', 'rider_season_rank', '_rider_free')
                   -- Ergebnis-Spalten mit alten Namen lassen sich nicht per "create or replace" ändern
                   or p.proargnames && array['rider_slug', 'race_slug', 'uci_points', 'uci_rank', 'uci_class', 'pcs_slug',
                                             'riders', 'current_rider', 'add_rider', 'drop_rider', 'give_riders', 'take_riders']) loop
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
create index if not exists athletes_gender_rank on athletes (gender, pool_rank);

-- Toplisten-Einträge (DE, Senioren, Laufdisziplinen ab 800 m) – Grundlage für den Pool
create table if not exists toplist_entries (
  athlete_id text not null references athletes (id) on delete cascade,
  year       int  not null,
  discipline text not null,
  mark       text,
  score      int  not null,
  updated_at timestamptz not null default now(),
  primary key (athlete_id, year, discipline)
);

-- Disziplinen: eigener Faktor, Gruppe für Positionen, WA-Platzierungstabellen (Werte: reference_data.sql)
create table if not exists disciplines (
  name           text primary key,             -- wie bei World Athletics, z. B. '1500 Metres'
  factor         numeric not null default 1,
  event_group    text,
  placing_tables text[] not null default '{}',
  cross_table    text                           -- Cross: Punkte nach Platz statt Leistungspunkten
);

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
insert into scoring_config (id) values (1) on conflict do nothing;

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
-- Rekord laut Admin: DR (deutscher), ER (Europa-), WR (Weltrekord); der Importer lässt die Spalte unverändert
alter table wa_results add column if not exists record text;
do $$ begin
  alter table wa_results add constraint wa_results_record_check check (record in ('DR', 'ER', 'WR'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table wa_results add constraint wa_results_source_check check (source in ('wa', 'manual'));
exception when duplicate_object then null; end $$;

-- WA-Punktetabellen nachgebaut: Punkte = a·t² + b·t + c (t = Zeit in Sekunden), je Disziplin und Geschlecht
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
alter table results add column if not exists record_points numeric not null default 0;          -- Rekord-Bonus                        -- Quelle in wa_results
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
alter table calendar_events add column if not exists events jsonb;              -- Laufdisziplinen laut Programm: [{gender, events[]}]
alter table calendar_events add column if not exists events_checked_at timestamptz;

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

-- =====================================================================
-- Hilfsfunktionen
-- =====================================================================

-- Passt das Geschlecht des Athleten zur Wertung der Liga (men, women, mixed)?
create or replace function _gender_ok(p_league_gender text, p_rider_gender text) returns boolean
language sql immutable as $$
  select p_league_gender = 'mixed' or p_league_gender = p_rider_gender;
$$;

create or replace function is_member(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from managers where league_id = p_league and user_id = auth.uid());
$$;

create or replace function is_admin(p_league uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leagues where id = p_league and admin_user = auth.uid());
$$;

create or replace function my_manager(p_league uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from managers where league_id = p_league and user_id = auth.uid();
$$;

create or replace function server_now() returns timestamptz
language sql stable as $$ select now(); $$;

create or replace function _is_service() returns boolean
language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role' or session_user in ('postgres', 'supabase_admin');
$$;

create or replace function _require_member(p_league uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  v := my_manager(p_league);
  if v is null then raise exception 'Du bist kein Mitglied dieser Liga.'; end if;
  return v;
end $$;

create or replace function _require_admin(p_league uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin(p_league) then raise exception 'Nur der Liga-Admin darf das.'; end if;
end $$;

-- Benachrichtigung an den Nutzer hinter einem Manager (Platzhalter ohne Konto werden übersprungen)
create or replace function _notify(p_manager uuid, p_title text, p_body text, p_url text) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, title, body, url)
  select user_id, p_title, p_body, p_url from managers where id = p_manager and user_id is not null
    and exists (select 1 from push_subscriptions s where s.user_id = managers.user_id);
$$;

-- „Du bist dran“ im Draft: sofort senden (Ablauf direkt anstoßen), verfällt mit der Pick-Uhr
create or replace function _notify_turn(p_league uuid, p_manager uuid, p_prev uuid, p_text text, p_expires timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_manager is null or p_manager is not distinct from p_prev then return; end if;   -- gleicher Manager wie eben
  insert into notifications (user_id, title, body, url, expires_at)
  select m.user_id, '⏰ Du bist dran!', l.name || ': ' || p_text, '#/league/' || p_league || '/draft', p_expires
    from managers m join leagues l on l.id = m.league_id
   where m.id = p_manager and m.user_id is not null
     and exists (select 1 from push_subscriptions s where s.user_id = m.user_id);
  if found then
    begin
      perform dispatch_workflow('push.yml');
    exception when others then null;    -- ohne Token: Versand beim nächsten Zeitplaner-Lauf
    end;
  end if;
end $$;

create or replace function _rname(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select name from athletes where id = p_slug), p_slug);
$$;

create or replace function vapid_public_key() returns text
language sql stable security definer set search_path = public as $$
  select value from app_config where key = 'vapid_public';
$$;

create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Bitte zuerst anmelden.'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

create or replace function _log(p_league uuid, p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into admin_log (league_id, user_id, action, details) values (p_league, auth.uid(), p_action, p_details);
$$;

-- Freie Kaderplätze eines Managers
create or replace function _open_slots(p_manager uuid) returns int
language sql stable security definer set search_path = public as $$
  select l.roster_size - (select count(*) from roster_entries r where r.manager_id = m.id and r.released_on is null)::int
  from managers m join leagues l on l.id = m.league_id where m.id = p_manager;
$$;

-- Höchstgebot im Draft: Restbudget minus (offene Plätze − 1) × Mindestgebot
create or replace function _max_bid(p_manager uuid) returns int
language sql stable security definer set search_path = public as $$
  select case when _open_slots(m.id) <= 0 then 0 else m.budget_left - (_open_slots(m.id) - 1) end
  from managers m where m.id = p_manager;
$$;

-- Würde der Manager mit diesem Fahrer die Grenze pro Profiteam überschreiten?
create or replace function _team_limit_ok(p_manager uuid, p_rider text, p_without text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select l.max_per_team is null
      or rd.team is null
      or (select count(*) from roster_entries re join athletes x on x.id = re.athlete_id
          where re.manager_id = m.id and re.released_on is null and x.team = rd.team
            and re.athlete_id is distinct from p_without) < l.max_per_team
  from managers m join leagues l on l.id = m.league_id, athletes rd
  where m.id = p_manager and rd.id = p_rider;
$$;

-- Ist ein Fahrer in der Liga frei? Abgegebene Fahrer sind gesperrt, wenn sie
-- seit p_locked_since abgegeben wurden (= bis zum nächsten Stichtag).
create or replace function _athlete_free(p_league uuid, p_rider text, p_locked_since timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from athletes r join leagues l on l.id = p_league
                 where r.id = p_rider and _gender_ok(l.gender, r.gender) and r.pool_rank is not null)
     and not exists (select 1 from roster_entries
                     where league_id = p_league and athlete_id = p_rider
                       and (released_on is null or released_at >= p_locked_since));
$$;

create or replace function _release(p_league uuid, p_manager uuid, p_rider text, p_on date) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update roster_entries set released_on = p_on, released_at = now()
   where league_id = p_league and manager_id = p_manager and athlete_id = p_rider and released_on is null;
  return found;
end $$;

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

-- =====================================================================
-- Liga anlegen, beitreten, verwalten
-- =====================================================================

create or replace function create_league(p_name text, p_team_name text, p_settings jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; s jsonb := coalesce(p_settings, '{}');
begin
  if auth.uid() is null then raise exception 'Bitte zuerst anmelden.'; end if;
  insert into leagues (name, admin_user, max_managers, roster_size, scoring_mode, max_per_team,
                       draft_mode, draft_order, bid_seconds, waiver_mode, gender, season_start, season_end, transfer_mode,
                       lineup_mode, lineup_groups, wildcards)
  values (p_name, auth.uid(),
          coalesce((s->>'max_managers')::int, 8),
          coalesce((s->>'roster_size')::int, 11),
          coalesce(s->>'scoring_mode', 'lineup'),
          (s->>'max_per_team')::int,
          coalesce(s->>'draft_mode', 'snake'),
          coalesce(s->>'draft_order', 'ranking'),
          coalesce((s->>'bid_seconds')::int, 30),
          coalesce(s->>'waiver_mode', 'priority'),
          coalesce(s->>'gender', 'mixed'),
          coalesce((s->>'season_start')::date, make_date(extract(year from current_date)::int + 1, 1, 1)),
          coalesce((s->>'season_end')::date, make_date(extract(year from current_date)::int + 1, 12, 31)),
          coalesce(s->>'transfer_mode', 'waiver_free'),
          coalesce(s->>'lineup_mode', 'free'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(s->'lineup_groups') x),
                   array['800', '1500', '5000', '10000', 'Marathon', 'Hindernis']),
          coalesce((s->>'wildcards')::int, 2))
  returning id into v_id;
  insert into managers (league_id, user_id, team_name) values (v_id, auth.uid(), p_team_name);
  insert into draft_state (league_id) values (v_id);
  return v_id;
end $$;

-- Liga-Infos für die Beitrittsseite (ohne Mitglied zu sein)
create or replace function league_by_code(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'status', l.status, 'max_managers', l.max_managers,
    'members', (select count(*) from managers m where m.league_id = l.id),
    'already_member', exists (select 1 from managers m where m.league_id = l.id and m.user_id = auth.uid()),
    'placeholders', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'team_name', m.team_name))
                              from managers m where m.league_id = l.id and m.user_id is null), '[]'))
  from leagues l where l.invite_code = p_code;
$$;

create or replace function join_league(p_code text, p_team_name text, p_claim uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare l leagues;
begin
  if auth.uid() is null then raise exception 'Bitte zuerst anmelden.'; end if;
  select * into l from leagues where invite_code = p_code;
  if not found then raise exception 'Einladungslink ungültig.'; end if;
  if exists (select 1 from managers where league_id = l.id and user_id = auth.uid()) then return l.id; end if;
  if p_claim is not null then
    update managers set user_id = auth.uid(), team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
     where id = p_claim and league_id = l.id and user_id is null;
    if not found then raise exception 'Dieser Platz ist schon vergeben.'; end if;
    return l.id;
  end if;
  if l.status <> 'setup' then raise exception 'Der Draft hat schon begonnen. Übernimm einen freien Platz.'; end if;
  if (select count(*) from managers where league_id = l.id) >= l.max_managers then
    raise exception 'Die Liga ist voll.';
  end if;
  insert into managers (league_id, user_id, team_name) values (l.id, auth.uid(), p_team_name);
  return l.id;
end $$;

create or replace function set_team_name(p_league uuid, p_team_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update managers set team_name = p_team_name where id = _require_member(p_league);
end $$;

create or replace function add_placeholder_manager(p_league uuid, p_team_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; l leagues;
begin
  perform _require_admin(p_league);
  select * into l from leagues where id = p_league;
  if l.status <> 'setup' then raise exception 'Nur vor dem Draft möglich.'; end if;
  if (select count(*) from managers where league_id = p_league) >= l.max_managers then raise exception 'Die Liga ist voll.'; end if;
  insert into managers (league_id, team_name) values (p_league, p_team_name) returning id into v;
  return v;
end $$;

-- Vor dem Draft: Manager entfernen. Danach: Konto lösen, Kader bleibt für einen Nachfolger.
create or replace function remove_manager(p_league uuid, p_manager uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l leagues; m managers;
begin
  select * into l from leagues where id = p_league;
  select * into m from managers where id = p_manager and league_id = p_league;
  if not found then raise exception 'Manager nicht gefunden.'; end if;
  if not (is_admin(p_league) or m.user_id = auth.uid()) then raise exception 'Keine Berechtigung.'; end if;
  if m.user_id = l.admin_user then raise exception 'Übertrage zuerst die Admin-Rechte.'; end if;
  if l.status = 'setup' then
    delete from managers where id = p_manager;
  else
    update managers set user_id = null where id = p_manager;
  end if;
  perform _log(p_league, 'remove_manager', jsonb_build_object('manager', p_manager, 'team', m.team_name));
end $$;

create or replace function transfer_admin(p_league uuid, p_manager uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform _require_admin(p_league);
  select user_id into v from managers where id = p_manager and league_id = p_league;
  if v is null then raise exception 'Dieser Manager hat kein Konto.'; end if;
  update leagues set admin_user = v where id = p_league;
  perform _log(p_league, 'transfer_admin', jsonb_build_object('manager', p_manager));
end $$;

create or replace function update_league_settings(p_league uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare l leagues; s jsonb := p_settings;
begin
  perform _require_admin(p_league);
  select * into l from leagues where id = p_league for update;
  if l.status = 'setup' then
    update leagues set
      name         = coalesce(s->>'name', name),
      max_managers = coalesce((s->>'max_managers')::int, max_managers),
      roster_size  = coalesce((s->>'roster_size')::int, roster_size),
      max_per_team = case when s ? 'max_per_team' then (s->>'max_per_team')::int else max_per_team end,
      draft_mode   = coalesce(s->>'draft_mode', draft_mode),
      draft_order  = coalesce(s->>'draft_order', draft_order),
      bid_seconds  = coalesce((s->>'bid_seconds')::int, bid_seconds),
      gender       = coalesce(s->>'gender', gender),
      season_start = coalesce((s->>'season_start')::date, season_start),
      lineup_mode  = coalesce(s->>'lineup_mode', lineup_mode),
      lineup_groups = case when s ? 'lineup_groups' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(s->'lineup_groups') x)
                           else lineup_groups end,
      wildcards    = coalesce((s->>'wildcards')::int, wildcards)
    where id = p_league;
    if (select count(*) from managers where league_id = p_league) > (select max_managers from leagues where id = p_league) then
      raise exception 'Es sind schon mehr Manager beigetreten.';
    end if;
  elsif s ?| array['max_managers', 'roster_size', 'max_per_team', 'draft_mode', 'draft_order', 'gender', 'season_start', 'bid_seconds',
                   'lineup_mode', 'lineup_groups', 'wildcards'] then
    raise exception 'Diese Einstellung ist nach dem Draft nicht mehr änderbar.';
  end if;
  -- jederzeit änderbar
  update leagues set
    name         = coalesce(s->>'name', name),
    scoring_mode = coalesce(s->>'scoring_mode', scoring_mode),
    waiver_mode  = coalesce(s->>'waiver_mode', waiver_mode),
    transfer_mode = coalesce(s->>'transfer_mode', transfer_mode),
    season_end   = coalesce((s->>'season_end')::date, season_end)
  where id = p_league;
  -- Transfermodus geändert: künftige Spieltage mit Standard-Fristen neu berechnen
  if s ? 'transfer_mode' and s->>'transfer_mode' is distinct from l.transfer_mode then
    perform _reset_default_deadlines(p_league, l.transfer_mode);
  end if;
  perform _log(p_league, 'settings', s);
end $$;

create or replace function delete_league(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin(p_league);
  delete from leagues where id = p_league;
end $$;

-- =====================================================================
-- Neue Saison: Liga kopieren und Keeper
-- =====================================================================

create or replace function copy_league(p_league uuid, p_name text, p_season_start date, p_season_end date,
                                       p_keeper_count int default 0, p_keeper_surcharge int default 5)
returns uuid language plpgsql security definer set search_path = public as $$
declare l leagues; v uuid;
begin
  perform _require_admin(p_league);
  select * into l from leagues where id = p_league;
  insert into leagues (name, admin_user, max_managers, roster_size, scoring_mode, max_per_team, draft_mode,
                       draft_order, bid_seconds, waiver_mode, gender, season_start, season_end, prev_league,
                       keeper_count, keeper_surcharge, transfer_mode, lineup_mode, lineup_groups, wildcards)
  values (coalesce(nullif(trim(p_name), ''), l.name), l.admin_user, l.max_managers, l.roster_size, l.scoring_mode,
          l.max_per_team, l.draft_mode, l.draft_order, l.bid_seconds, l.waiver_mode, l.gender,
          p_season_start, p_season_end, p_league, coalesce(p_keeper_count, 0), coalesce(p_keeper_surcharge, 5),
          l.transfer_mode, l.lineup_mode, l.lineup_groups, l.wildcards)
  returning id into v;
  insert into managers (league_id, user_id, team_name, prev_manager)
    select v, user_id, team_name, id from managers where league_id = p_league order by draft_position nulls last, joined_at;
  insert into draft_state (league_id) values (v);
  perform _log(p_league, 'copy_league', jsonb_build_object('new_league', v));
  return v;
end $$;

-- Mögliche Keeper des aufrufenden Managers: sein Kader am Ende der Vorsaison
create or replace function keeper_options(p_league uuid)
returns table (athlete_id text, prev_price int, price int, chosen boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid; l leagues;
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  return query
  select re.athlete_id, re.price, greatest(1, re.price + l.keeper_surcharge),
         exists (select 1 from keepers k where k.manager_id = v_me and k.athlete_id = re.athlete_id)
    from managers m join roster_entries re on re.manager_id = m.prev_manager and re.released_on is null
   where m.id = v_me
   order by re.price desc;
end $$;

create or replace function set_keepers(p_league uuid, p_riders text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid; l leagues; v_sum int; v_n int := coalesce(array_length(p_riders, 1), 0);
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  if l.status <> 'setup' then raise exception 'Keeper können nur vor dem Draft gewählt werden.'; end if;
  if v_n > l.keeper_count then raise exception 'Du darfst höchstens % Keeper wählen.', l.keeper_count; end if;
  if exists (select 1 from unnest(p_riders) r where r not in (select o.athlete_id from keeper_options(p_league) o)) then
    raise exception 'Nur Athleten aus deinem Vorjahreskader.';
  end if;
  select coalesce(sum(o.price), 0) into v_sum from keeper_options(p_league) o where o.athlete_id = any (p_riders);
  if l.draft_mode in ('live', 'blind') and v_sum > l.budget - (l.roster_size - v_n) then
    raise exception 'Zu teuer: Keeper kosten %, es muss Budget für die restlichen Plätze bleiben.', v_sum;
  end if;
  delete from keepers where manager_id = v_me;
  insert into keepers (league_id, manager_id, athlete_id, price)
    select p_league, v_me, o.athlete_id, o.price from keeper_options(p_league) o where o.athlete_id = any (p_riders);
exception when unique_violation then
  raise exception 'Dieser Athlet ist schon Keeper eines anderen Managers.';
end $$;

-- =====================================================================
-- Live-Auktions-Draft
-- =====================================================================

create or replace function _draft_next(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l leagues; d draft_state; v_rider text; v_cur_pos int; v_next uuid;
        v_n int; v_pick int; v_round int; v_idx int; v_pos int;
begin
  select * into l from leagues where id = p_league;
  delete from draft_sealed where league_id = p_league;
  update draft_state set sealed_done = '{}', tie_bidders = null where league_id = p_league;
  select * into d from draft_state where league_id = p_league;

  if not exists (select 1 from managers m where m.league_id = p_league and _open_slots(m.id) > 0) then
    update draft_state set status = 'done', current_athlete = null, current_bid = 0, current_bidder = null,
                           deadline = null, nominator = null, updated_at = now()
     where league_id = p_league;
    update leagues set status = 'active', last_waiver_run = now() where id = p_league;
    perform _notify(m.id, '🏁 Draft beendet!', l.name || ': Dein Draft-Report mit Note ist da.', '#/league/' || p_league || '/draft')
       from managers m where m.league_id = p_league;
    return;
  end if;

  if l.draft_mode = 'snake' then
    -- Schlangenreihenfolge: Runde 1 vorwärts, Runde 2 rückwärts, …
    select count(*) into v_n from managers where league_id = p_league;
    v_pick := d.lot_no;
    loop
      v_pick := v_pick + 1;
      v_round := (v_pick - 1) / v_n;
      v_idx := (v_pick - 1) % v_n;
      v_pos := case when v_round % 2 = 0 then v_idx + 1 else v_n - v_idx end;
      select id into v_next from managers where league_id = p_league
       order by draft_position, id offset v_pos - 1 limit 1;
      exit when _open_slots(v_next) > 0;      -- Manager mit vollem Kader (Keeper) überspringen
    end loop;
    update draft_state set phase = 'snake', lot_no = v_pick, current_athlete = null, current_bid = 0, current_bidder = null,
                           nominator = v_next, deadline = now() + make_interval(secs => l.bid_seconds), updated_at = now()
     where league_id = p_league;
    perform _notify_turn(p_league, v_next, d.nominator, 'Dein Pick (Nr. ' || v_pick || ') – du hast ' || l.bid_seconds || ' Sekunden.',
                         now() + make_interval(secs => l.bid_seconds));
    return;
  end if;

  if d.phase = 'auction' and l.draft_order = 'ranking' then
    select r.id into v_rider from athletes r
     where _gender_ok(l.gender, r.gender) and r.pool_rank is not null and not r.inactive
       and not exists (select 1 from draft_lots x where x.league_id = p_league and x.athlete_id = r.id)
     order by r.pool_rank, r.id limit 1;
    if v_rider is not null then
      update draft_state set lot_no = lot_no + 1, current_athlete = v_rider, current_bid = 0, current_bidder = null,
                             deadline = now() + make_interval(secs => l.bid_seconds), updated_at = now()
       where league_id = p_league;
      return;
    end if;
    update draft_state set phase = 'fill' where league_id = p_league;   -- Rangliste durch
  end if;

  -- Reihum: nächster Manager mit freiem Platz nominiert (bzw. wählt in der Auffüllphase)
  select draft_position into v_cur_pos from managers where id = d.nominator;
  select m.id into v_next from managers m
   where m.league_id = p_league and _open_slots(m.id) > 0
   order by case when m.draft_position > coalesce(v_cur_pos, 0) then 0 else 1 end, m.draft_position
   limit 1;
  update draft_state set current_athlete = null, current_bid = 0, current_bidder = null, deadline = null,
                         nominator = v_next, updated_at = now()
   where league_id = p_league;
  perform _notify_turn(p_league, v_next, d.nominator,
    case when d.phase = 'fill' or (d.phase = 'auction' and l.draft_order = 'ranking') then 'Wähle einen Athleten zum Auffüllen.'
         else 'Du nominierst den nächsten Athleten.' end, null);
end $$;

create or replace function start_draft(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin(p_league);
  perform _start_draft(p_league);
  perform _log(p_league, 'start_draft', null);
end $$;

-- Geplanten Draft starten, sobald die Zeit erreicht ist (darf jedes Mitglied auslösen)
create or replace function start_scheduled_draft(p_league uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare l leagues;
begin
  if not is_member(p_league) then raise exception 'Keine Berechtigung.'; end if;
  select * into l from leagues where id = p_league for update;
  if l.status <> 'setup' or l.draft_mode = 'offline' or l.draft_at is null or l.draft_at > now() then
    return false;
  end if;
  perform _start_draft(p_league);
  insert into admin_log (league_id, user_id, action, details) values (p_league, null, 'start_draft', '{"geplant": true}');
  return true;
end $$;

create or replace function schedule_draft(p_league uuid, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin(p_league);
  if (select status from leagues where id = p_league) <> 'setup' then raise exception 'Der Draft wurde schon gestartet.'; end if;
  if p_at is not null and p_at < now() - interval '1 minute' then raise exception 'Der Zeitpunkt liegt in der Vergangenheit.'; end if;
  update leagues set draft_at = p_at where id = p_league;
  perform _log(p_league, 'schedule_draft', jsonb_build_object('at', p_at));
end $$;

create or replace function _start_draft(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l leagues;
begin
  select * into l from leagues where id = p_league for update;
  if l.status <> 'setup' then raise exception 'Der Draft wurde schon gestartet.'; end if;
  if l.draft_mode = 'offline' then raise exception 'Diese Liga nutzt den Offline-Import.'; end if;
  if (select count(*) from managers where league_id = p_league) < 2 then raise exception 'Mindestens 2 Manager nötig.'; end if;
  if not exists (select 1 from athletes where _gender_ok(l.gender, gender) and pool_rank is not null) then
    raise exception 'Noch keine Athleten importiert (Workflow "Athletenpool laden").';
  end if;

  update managers m set draft_position = s.rn, budget_left = l.budget
    from (select id, row_number() over (order by random()) rn from managers where league_id = p_league) s
   where m.id = s.id;
  -- Keeper vorab in die Kader (zählen wie gekauft; die Auktion überspringt sie)
  insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
    select p_league, k.manager_id, k.athlete_id, k.price, 'draft', l.season_start from keepers k where k.league_id = p_league;
  update managers m set budget_left = budget_left - coalesce((select sum(price) from keepers k where k.manager_id = m.id), 0)
   where m.league_id = p_league;
  insert into draft_lots (league_id, lot_no, athlete_id, manager_id, price)
    select p_league, 0, k.athlete_id, k.manager_id, k.price from keepers k where k.league_id = p_league
  on conflict (league_id, athlete_id) do nothing;
  insert into draft_state (league_id) values (p_league) on conflict (league_id) do nothing;
  update draft_state set status = 'running', phase = 'auction', lot_no = 0, current_athlete = null, current_bid = 0,
                         current_bidder = null, deadline = null, nominator = null, updated_at = now()
   where league_id = p_league;
  update leagues set status = 'drafting' where id = p_league;
  perform _draft_next(p_league);
  perform _notify(m.id, '🏃 Der Draft startet jetzt!', l.name || ': Ab in den Draft-Raum.', '#/league/' || p_league || '/draft')
     from managers m where m.league_id = p_league;
end $$;

create or replace function pause_draft(p_league uuid, p_pause boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state;
begin
  perform _require_admin(p_league);
  select * into d from draft_state where league_id = p_league for update;
  if p_pause and d.status = 'running' then
    update draft_state set status = 'paused',
           paused_remaining = case when deadline is null then null else greatest(deadline - now(), interval '5 seconds') end,
           deadline = null, updated_at = now()
     where league_id = p_league;
  elsif not p_pause and d.status = 'paused' then
    update draft_state set status = 'running',
           deadline = case when paused_remaining is null then null else now() + paused_remaining end,
           paused_remaining = null, updated_at = now()
     where league_id = p_league;
  end if;
end $$;

create or replace function draft_bid(p_league uuid, p_amount int) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues; v_me uuid; v_max int;
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league for update;
  if d.status <> 'running' then raise exception 'Der Draft läuft gerade nicht.'; end if;
  if d.current_athlete is null or d.deadline is null or now() >= d.deadline then raise exception 'Gerade wird kein Athlet versteigert.'; end if;
  if l.draft_mode = 'blind' then
    if d.phase <> 'tiebreak' then raise exception 'In der Blind-Auktion wird verdeckt geboten.'; end if;
    if not (v_me = any (d.tie_bidders)) then raise exception 'Nur die Manager mit Gleichstand bieten im Stechen.'; end if;
    if p_amount <> d.current_bid + 1 then raise exception 'Im Stechen wird genau um 1 erhöht (auf %).', d.current_bid + 1; end if;
  end if;
  if d.current_bidder = v_me then raise exception 'Du bist schon Höchstbietender.'; end if;
  if _open_slots(v_me) <= 0 then raise exception 'Dein Kader ist voll.'; end if;
  if p_amount < greatest(l.min_bid, d.current_bid + 1) then
    raise exception 'Gebot muss mindestens % sein.', greatest(l.min_bid, d.current_bid + 1);
  end if;
  v_max := _max_bid(v_me);
  if p_amount > v_max then raise exception 'Dein Höchstgebot ist %.', v_max; end if;
  if not _team_limit_ok(v_me, d.current_athlete) then raise exception 'Du hast schon die Höchstzahl an Athleten dieses Teams.'; end if;

  update draft_state set current_bid = p_amount, current_bidder = v_me,
         deadline = now() + make_interval(secs => l.bid_seconds), updated_at = now()
   where league_id = p_league;
  insert into draft_bids (league_id, lot_no, manager_id, amount) values (p_league, d.lot_no, v_me, p_amount);
  -- Stechen: kann kein anderer mehr erhöhen, sofort Zuschlag
  if l.draft_mode = 'blind' and not exists (select 1 from unnest(d.tie_bidders) t
       where t <> v_me and _max_bid(t) >= p_amount + 1 and _team_limit_ok(t, d.current_athlete)) then
    perform _draft_award(p_league, v_me, p_amount);
  end if;
end $$;

-- Zuschlag für den aktuellen Fahrer (Blind-Auktion) und weiter zum nächsten
create or replace function _draft_award(p_league uuid, p_manager uuid, p_price int) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues;
begin
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league;
  if p_manager is not null then
    insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
    values (p_league, p_manager, d.current_athlete, p_price, 'draft', l.season_start);
    update managers set budget_left = budget_left - p_price where id = p_manager;
  end if;
  insert into draft_lots (league_id, lot_no, athlete_id, manager_id, price)
  values (p_league, d.lot_no, d.current_athlete, p_manager, case when p_manager is null then 0 else p_price end);
  update draft_state set phase = case when phase = 'tiebreak' then 'auction' else phase end where league_id = p_league;
  perform _draft_next(p_league);
end $$;

-- Blind-Auktion: verdeckte Gebote auswerten. Höchstgebot gewinnt; bei Gleichstand Stechen um +1,
-- den Vorrang (wer ohne Erhöhung gewinnt) bekommen die Gleichauf-Bieter reihum.
create or replace function _blind_resolve(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues; v_max int; v_tied uuid[]; v_lead uuid; v_pos int;
begin
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league;
  -- Gebote offenlegen
  insert into draft_bids (league_id, lot_no, manager_id, amount)
    select league_id, d.lot_no, manager_id, amount from draft_sealed where league_id = p_league order by amount desc;
  select max(amount) into v_max from draft_sealed where league_id = p_league;
  if v_max is null then
    perform _draft_award(p_league, null, 0);            -- niemand hat geboten: übersprungen
    return;
  end if;
  select array_agg(s.manager_id order by m.draft_position) into v_tied
    from draft_sealed s join managers m on m.id = s.manager_id
   where s.league_id = p_league and s.amount = v_max;
  if array_length(v_tied, 1) = 1 then
    perform _draft_award(p_league, v_tied[1], v_max);
    return;
  end if;
  -- reihum: erster Gleichauf-Bieter nach dem letzten Vorrang
  select m.id, m.draft_position into v_lead, v_pos from managers m where m.id = any (v_tied)
   order by case when m.draft_position > d.tie_ptr then 0 else 1 end, m.draft_position limit 1;
  update draft_state set tie_ptr = v_pos where league_id = p_league;
  delete from draft_sealed where league_id = p_league;
  if not exists (select 1 from unnest(v_tied) t where t <> v_lead and _max_bid(t) >= v_max + 1) then
    perform _draft_award(p_league, v_lead, v_max);      -- niemand kann erhöhen
    return;
  end if;
  update draft_state set phase = 'tiebreak', tie_bidders = v_tied, sealed_done = '{}',
         current_bid = v_max, current_bidder = v_lead,
         deadline = now() + make_interval(secs => l.bid_seconds), updated_at = now()
   where league_id = p_league;
end $$;

-- Blind-Auktion: verdecktes Gebot abgeben, ändern oder zurückziehen (0)
create or replace function draft_blind_bid(p_league uuid, p_amount int) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues; v_me uuid; v_max int;
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league for update;
  if l.draft_mode <> 'blind' then raise exception 'Diese Liga nutzt keine Blind-Auktion.'; end if;
  if d.status <> 'running' or d.phase <> 'auction' or d.current_athlete is null or d.deadline is null or now() >= d.deadline then
    raise exception 'Gerade wird kein Athlet versteigert.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    delete from draft_sealed where league_id = p_league and manager_id = v_me;
    update draft_state set sealed_done = array_remove(sealed_done, v_me), updated_at = now() where league_id = p_league;
    return;
  end if;
  if _open_slots(v_me) <= 0 then raise exception 'Dein Kader ist voll.'; end if;
  v_max := _max_bid(v_me);
  if p_amount > v_max then raise exception 'Dein Höchstgebot ist %.', v_max; end if;
  if not _team_limit_ok(v_me, d.current_athlete) then raise exception 'Du hast schon die Höchstzahl an Athleten dieses Teams.'; end if;
  insert into draft_sealed (league_id, lot_no, manager_id, amount) values (p_league, d.lot_no, v_me, p_amount)
  on conflict (league_id, manager_id) do update set amount = excluded.amount, lot_no = excluded.lot_no, created_at = now();
  update draft_state set sealed_done = array_append(array_remove(sealed_done, v_me), v_me), updated_at = now()
   where league_id = p_league;
  -- Haben alle geboten, die noch bieten können? Dann sofort auswerten.
  if not exists (select 1 from managers m where m.league_id = p_league and _max_bid(m.id) >= 1
                    and _team_limit_ok(m.id, d.current_athlete)
                    and not exists (select 1 from draft_sealed s where s.league_id = p_league and s.manager_id = m.id)) then
    perform _blind_resolve(p_league);
  end if;
end $$;

-- Wird von allen Clients aufgerufen, wenn die Uhr abläuft. Nur der erste Aufruf wirkt.
create or replace function draft_tick(p_league uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues;
begin
  if not (is_member(p_league) or _is_service()) then raise exception 'Keine Berechtigung.'; end if;
  select * into d from draft_state where league_id = p_league for update;
  if d.status <> 'running' or d.deadline is null or now() < d.deadline then return; end if;
  select * into l from leagues where id = p_league;

  if d.phase = 'snake' then
    perform _snake_pick(p_league, null);
    return;
  end if;
  if l.draft_mode = 'blind' and d.current_athlete is not null then
    if d.phase = 'tiebreak' then perform _draft_award(p_league, d.current_bidder, d.current_bid);
    else perform _blind_resolve(p_league); end if;
    return;
  end if;

  if d.current_athlete is not null then
    if d.current_bid > 0 and d.current_bidder is not null then
      insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
      values (p_league, d.current_bidder, d.current_athlete, d.current_bid, 'draft', l.season_start);
      update managers set budget_left = budget_left - d.current_bid where id = d.current_bidder;
      insert into draft_lots (league_id, lot_no, athlete_id, manager_id, price)
      values (p_league, d.lot_no, d.current_athlete, d.current_bidder, d.current_bid);
    else
      insert into draft_lots (league_id, lot_no, athlete_id, manager_id, price)
      values (p_league, d.lot_no, d.current_athlete, null, 0);
    end if;
  end if;
  perform _draft_next(p_league);
end $$;

-- Snake-Draft: Pick ausführen (p_rider null = automatisch bester freier Fahrer nach UCI-Rang)
create or replace function _snake_pick(p_league uuid, p_rider text) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues; v_rider text := p_rider;
begin
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league;
  if v_rider is null then
    select r.id into v_rider from athletes r
     where _gender_ok(l.gender, r.gender) and r.pool_rank is not null and not r.inactive
       and _athlete_free(p_league, r.id, 'infinity') and _team_limit_ok(d.nominator, r.id)
     order by r.pool_rank, r.id limit 1;
    if v_rider is null then raise exception 'Kein freier Athlet mehr verfügbar.'; end if;
  end if;
  insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
  values (p_league, d.nominator, v_rider, 0, 'draft', l.season_start);
  insert into draft_lots (league_id, lot_no, athlete_id, manager_id, price)
  values (p_league, d.lot_no, v_rider, d.nominator, 0)
  on conflict (league_id, athlete_id) do update set manager_id = excluded.manager_id, price = 0, lot_no = excluded.lot_no;
  perform _draft_next(p_league);
end $$;

create or replace function draft_snake_pick(p_league uuid, p_rider text) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; v_me uuid;
begin
  v_me := _require_member(p_league);
  select * into d from draft_state where league_id = p_league for update;
  if d.status <> 'running' or d.phase <> 'snake' then raise exception 'Der Snake-Draft läuft gerade nicht.'; end if;
  if d.nominator is distinct from v_me and not is_admin(p_league) then raise exception 'Du bist nicht an der Reihe.'; end if;
  if not _athlete_free(p_league, p_rider, 'infinity') then raise exception 'Dieser Athlet ist nicht verfügbar.'; end if;
  if not _team_limit_ok(d.nominator, p_rider) then raise exception 'Grenze pro Team erreicht.'; end if;
  perform _snake_pick(p_league, p_rider);
end $$;

-- Modus "reihum nominieren": der Nominierende bringt einen Fahrer mit Gebot 1 ein
create or replace function draft_nominate(p_league uuid, p_rider text) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues; v_me uuid;
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league for update;
  if d.status <> 'running' or d.phase <> 'auction' or d.current_athlete is not null then
    raise exception 'Gerade kann niemand nominieren.';
  end if;
  if d.nominator is distinct from v_me and not is_admin(p_league) then raise exception 'Du bist nicht an der Reihe.'; end if;
  if exists (select 1 from draft_lots where league_id = p_league and athlete_id = p_rider)
     or not _athlete_free(p_league, p_rider, 'infinity') then
    raise exception 'Dieser Athlet ist nicht verfügbar.';
  end if;
  if not _team_limit_ok(d.nominator, p_rider) then raise exception 'Grenze pro Team erreicht.'; end if;
  if l.draft_mode = 'blind' then
    update draft_state set lot_no = lot_no + 1, current_athlete = p_rider, current_bid = 0, current_bidder = null,
           deadline = now() + make_interval(secs => l.bid_seconds), updated_at = now()
     where league_id = p_league;
    return;
  end if;
  update draft_state set lot_no = lot_no + 1, current_athlete = p_rider, current_bid = 1, current_bidder = d.nominator,
         deadline = now() + make_interval(secs => l.bid_seconds), updated_at = now()
   where league_id = p_league;
  insert into draft_bids (league_id, lot_no, manager_id, amount) values (p_league, d.lot_no + 1, d.nominator, 1);
end $$;

-- Auffüllphase: Restplätze reihum mit freien Fahrern zum Preis 1
create or replace function draft_fill_pick(p_league uuid, p_rider text) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_state; l leagues; v_me uuid;
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  select * into d from draft_state where league_id = p_league for update;
  if d.status <> 'running' or d.phase <> 'fill' or d.nominator is null then raise exception 'Die Auffüllphase läuft nicht.'; end if;
  if d.nominator is distinct from v_me and not is_admin(p_league) then raise exception 'Du bist nicht an der Reihe.'; end if;
  if not _athlete_free(p_league, p_rider, 'infinity') then raise exception 'Dieser Athlet ist nicht verfügbar.'; end if;
  if not _team_limit_ok(d.nominator, p_rider) then raise exception 'Grenze pro Team erreicht.'; end if;
  insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
  values (p_league, d.nominator, p_rider, 1, 'draft', l.season_start);
  update managers set budget_left = budget_left - 1 where id = d.nominator;
  insert into draft_lots (league_id, lot_no, athlete_id, manager_id, price)
  values (p_league, d.lot_no + 1, p_rider, d.nominator, 1)
  on conflict (league_id, athlete_id) do update set manager_id = excluded.manager_id, price = 1;
  update draft_state set lot_no = lot_no + 1 where league_id = p_league;
  perform _draft_next(p_league);
end $$;

-- =====================================================================
-- Offline-Draft-Import
-- p_rows: [{"manager_id": "...", "athlete_id": "...", "price": 12}, …]
-- Gibt eine Liste von Fehlern zurück; nur ohne Fehler und mit p_commit wird gespeichert.
-- =====================================================================

create or replace function import_offline_draft(p_league uuid, p_rows jsonb, p_commit boolean default false)
returns text[] language plpgsql security definer set search_path = public as $$
declare l leagues; errs text[] := '{}'; r record;
begin
  perform _require_admin(p_league);
  select * into l from leagues where id = p_league for update;
  if l.status <> 'setup' then return array['Die Kader sind bereits fixiert.']; end if;

  create temp table _imp on commit drop as
    select (e->>'manager_id')::uuid manager_id, e->>'athlete_id' athlete_id,
           coalesce(nullif(e->>'price', '')::int, 0) price
      from jsonb_array_elements(p_rows) e;

  for r in select i.manager_id from _imp i where not exists (select 1 from managers m where m.id = i.manager_id and m.league_id = p_league) group by 1 loop
    errs := errs || format('Unbekannter Manager %s', r.manager_id);
  end loop;
  for r in select i.athlete_id from _imp i where not exists (select 1 from athletes x where x.id = i.athlete_id and _gender_ok(l.gender, x.gender)) loop
    errs := errs || format('Athlet %s nicht im Athletenpool gefunden', r.athlete_id);
  end loop;
  for r in select athlete_id from _imp group by 1 having count(*) > 1 loop
    errs := errs || format('Athlet %s ist mehrfach vergeben', r.athlete_id);
  end loop;
  for r in select m.team_name, count(i.athlete_id) n, coalesce(sum(i.price), 0) s
             from managers m left join _imp i on i.manager_id = m.id
            where m.league_id = p_league group by m.id, m.team_name loop
    if r.n <> l.roster_size then errs := errs || format('%s: %s statt %s Athleten', r.team_name, r.n, l.roster_size); end if;
    if r.s > l.budget then errs := errs || format('%s: Summe %s über Budget %s', r.team_name, r.s, l.budget); end if;
  end loop;
  for r in select * from _imp where price < 0 loop
    errs := errs || format('Negativer Preis bei %s', r.athlete_id);
  end loop;
  if l.max_per_team is not null then
    for r in select m.team_name, x.team, count(*) n from _imp i join athletes x on x.id = i.athlete_id
               join managers m on m.id = i.manager_id where x.team is not null
              group by m.team_name, x.team having count(*) > l.max_per_team loop
      errs := errs || format('%s: %s Athleten von %s (max. %s)', r.team_name, r.n, r.team, l.max_per_team);
    end loop;
  end if;

  if array_length(errs, 1) is null and p_commit then
    insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
      select p_league, manager_id, athlete_id, price, 'offline', l.season_start from _imp;
    update managers m set budget_left = l.budget - coalesce((select sum(price) from _imp i where i.manager_id = m.id), 0),
           draft_position = s.rn
      from (select id, row_number() over (order by random()) rn from managers where league_id = p_league) s
     where m.id = s.id;
    insert into draft_state (league_id) values (p_league) on conflict (league_id) do nothing;
    update draft_state set status = 'done' where league_id = p_league;
    update leagues set status = 'active', last_waiver_run = now() where id = p_league;
    perform _log(p_league, 'offline_import', jsonb_build_object('rows', jsonb_array_length(p_rows)));
  end if;
  drop table _imp;
  return errs;
end $$;

-- =====================================================================
-- Spieltage
-- =====================================================================

-- Standard-Stichtag (Kader und Aufstellung fest):
--   nur Waiver:          Vortag des Spieltags, 20:00 Uhr
--   Waiver + frei:       Spieltagstart, 00:00 Uhr
create or replace function _default_deadline(p_league uuid, p_start date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when (select transfer_mode from leagues where id = p_league) = 'waiver_free'
              then p_start::timestamp at time zone 'Europe/Berlin'
              else (p_start - 1 + time '20:00')::timestamp at time zone 'Europe/Berlin' end;
$$;

-- Standard-Waiver-Auswertung im zweiteiligen Modus: Ende des 7. Tags vor Start (0:00 Uhr des 6. Tags vor Start).
-- Ist der vorige Spieltag kürzer als 14 Tage: nach der Hälfte seiner Dauer. Nie vor dem vorigen Stichtag.
create or replace function _default_waiver_deadline(p_league uuid, p_start date, p_except uuid default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare prev matchdays; v timestamptz; v_lock timestamptz := _default_deadline(p_league, p_start);
begin
  if (select transfer_mode from leagues where id = p_league) <> 'waiver_free' then return null; end if;
  select * into prev from matchdays where league_id = p_league and starts_on < p_start
     and id is distinct from p_except order by starts_on desc limit 1;
  if found and prev.ends_on - prev.starts_on + 1 < 14 then
    v := (prev.starts_on + (prev.ends_on - prev.starts_on + 1) / 2 + 1)::timestamp at time zone 'Europe/Berlin';
  else
    v := (p_start - 6)::timestamp at time zone 'Europe/Berlin';
  end if;
  if prev.id is not null and v <= prev.deadline then
    v := (((prev.deadline + (v_lock - prev.deadline) / 2) at time zone 'Europe/Berlin')::date + 1)
         ::timestamp at time zone 'Europe/Berlin';
    if v <= prev.deadline or v >= v_lock then v := prev.deadline + (v_lock - prev.deadline) / 2; end if;
  end if;
  return least(v, v_lock);
end $$;

-- alte Signatur ohne Waiver-Frist entfernen (sonst ist der Aufruf mehrdeutig)
drop function if exists upsert_matchday(uuid, uuid, text, date, date, timestamptz);
create or replace function upsert_matchday(p_league uuid, p_id uuid, p_name text, p_start date, p_end date,
                                           p_deadline timestamptz default null, p_waiver_deadline timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; m matchdays; v_deadline timestamptz; v_wd timestamptz;
begin
  perform _require_admin(p_league);
  v_deadline := coalesce(p_deadline, _default_deadline(p_league, p_start));
  v_wd := coalesce(p_waiver_deadline, _default_waiver_deadline(p_league, p_start, p_id));
  if v_wd > v_deadline then raise exception 'Die Waiver-Auswertung muss vor dem Stichtag liegen.'; end if;
  if p_end < p_start then raise exception 'Das Enddatum liegt vor dem Startdatum.'; end if;
  if p_id is null then
    insert into matchdays (league_id, name, starts_on, ends_on, deadline, waiver_deadline)
    values (p_league, p_name, p_start, p_end, v_deadline, v_wd) returning id into v;
  else
    select * into m from matchdays where id = p_id and league_id = p_league;
    if not found then raise exception 'Spieltag nicht gefunden.'; end if;
    if m.waivers_done or coalesce(m.waiver_deadline, m.deadline) <= now() then
      raise exception 'Laufende und abgeschlossene Spieltage sind gesperrt.';
    end if;
    update matchdays set name = p_name, starts_on = p_start, ends_on = p_end, deadline = v_deadline, waiver_deadline = v_wd
     where id = p_id;
    v := p_id;
  end if;
  return v;
exception when exclusion_violation then
  raise exception 'Spieltage dürfen sich nicht überlappen.';
end $$;

create or replace function delete_matchday(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m matchdays;
begin
  select * into m from matchdays where id = p_id;
  if not found then raise exception 'Spieltag nicht gefunden.'; end if;
  perform _require_admin(m.league_id);
  if m.waivers_done or coalesce(m.waiver_deadline, m.deadline) <= now() then
    raise exception 'Laufende und abgeschlossene Spieltage sind gesperrt.';
  end if;
  delete from matchdays where id = p_id;
end $$;

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

-- =====================================================================
-- Punkte und Tabelle
-- =====================================================================

-- Alle Einzelergebnisse, die in der Liga zählen (eingefroren oder live)
create or replace function _score_rows(p_league uuid)
returns table (matchday_id uuid, manager_id uuid, athlete_id text, competition_id text, label text,
               result_date date, points numeric)
language sql stable security definer set search_path = public as $$
  select s.matchday_id, s.manager_id, s.athlete_id, s.competition_id, s.label, s.result_date, s.points
    from score_snapshot s join matchdays m on m.id = s.matchday_id
   where m.league_id = p_league and m.frozen
  union all
  select m.id, re.manager_id, re.athlete_id, r.competition_id, r.label, r.result_date, r.points
    from matchdays m
    join leagues l on l.id = m.league_id
    join roster_entries re on re.league_id = m.league_id
    join results r on r.athlete_id = re.athlete_id
                  and r.result_date between m.starts_on and m.ends_on
                  and r.result_date >= re.acquired_on
                  and (re.released_on is null or r.result_date < re.released_on)
   where m.league_id = p_league and not m.frozen and m.starts_on <= current_date
     and (coalesce(m.scoring_mode, l.scoring_mode) = 'full'
          or re.athlete_id in (select effective_lineup(m.id, re.manager_id)));
$$;

-- Punkte pro Spieltag, Manager und Fahrer (inkl. Admin-Korrekturen)
create or replace function _league_points(p_league uuid)
returns table (matchday_id uuid, manager_id uuid, athlete_id text, points numeric, overridden boolean)
language sql stable security definer set search_path = public as $$
  with agg as (
    select s.matchday_id, s.manager_id, s.athlete_id, sum(s.points) pts
      from _score_rows(p_league) s group by 1, 2, 3),
  ov as (select * from point_overrides o where o.league_id = p_league)
  select coalesce(a.matchday_id, ov.matchday_id), coalesce(a.manager_id, ov.manager_id),
         coalesce(a.athlete_id, ov.athlete_id), coalesce(ov.points, a.pts), ov.id is not null
    from agg a full join ov on ov.matchday_id = a.matchday_id and ov.manager_id = a.manager_id
                           and ov.athlete_id = a.athlete_id;
$$;

-- Liga-Tabelle mit Tiebreakern: Punkte, Spieltagssiege, bester Spieltag, weniger Budget ausgegeben
create or replace function _league_table(p_league uuid)
returns table (manager_id uuid, team_name text, total numeric, matchday_wins int, best_matchday numeric,
               spent int, "position" int)
language sql stable security definer set search_path = public as $$
  with lp as (select * from _league_points(p_league)),
  md as (select lp.matchday_id, lp.manager_id, sum(lp.points) p from lp group by 1, 2),
  mx as (select md.matchday_id, max(md.p) m from md group by 1),
  w  as (select md.manager_id, count(*)::int n from md join mx on mx.matchday_id = md.matchday_id
          where md.p = mx.m and mx.m > 0 group by 1),
  sp as (select re.manager_id, sum(re.price)::int s from roster_entries re
          where re.league_id = p_league and re.source in ('draft', 'offline') group by 1),
  t as (
    select m.id, m.team_name, coalesce((select sum(md.p) from md where md.manager_id = m.id), 0) tot,
           coalesce(w.n, 0) wins, coalesce((select max(md.p) from md where md.manager_id = m.id), 0) best,
           coalesce(sp.s, 0) spent
      from managers m left join w on w.manager_id = m.id left join sp on sp.manager_id = m.id
     where m.league_id = p_league)
  select t.id, t.team_name, t.tot, t.wins, t.best, t.spent,
         (rank() over (order by t.tot desc, t.wins desc, t.best desc, t.spent asc))::int
    from t order by 7, 2;
$$;

-- Waiver-Reihenfolge: Tabellenletzter zuerst; solange alle 0 Punkte haben, umgekehrte Draft-Reihenfolge
create or replace function _waiver_order(p_league uuid)
returns table (manager_id uuid, team_name text, waiver_pos int)
language sql stable security definer set search_path = public as $$
  with t as (select * from _league_table(p_league)),
  allzero as (select coalesce(bool_and(t.total = 0), true) z from t)
  select t.manager_id, t.team_name,
         (row_number() over (order by case when (select z from allzero) then 0 else t."position" end desc,
                                      m.draft_position desc nulls last))::int
    from t join managers m on m.id = t.manager_id
   order by 3;
$$;

create or replace function league_points(p_league uuid)
returns table (matchday_id uuid, manager_id uuid, athlete_id text, points numeric, overridden boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_member(p_league) or _is_service()) then raise exception 'Keine Berechtigung.'; end if;
  return query select * from _league_points(p_league);
end $$;

create or replace function league_table(p_league uuid)
returns table (manager_id uuid, team_name text, total numeric, matchday_wins int, best_matchday numeric,
               spent int, "position" int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_member(p_league) or _is_service()) then raise exception 'Keine Berechtigung.'; end if;
  return query select * from _league_table(p_league);
end $$;

create or replace function waiver_order(p_league uuid)
returns table (manager_id uuid, team_name text, waiver_pos int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_member(p_league) or _is_service()) then raise exception 'Keine Berechtigung.'; end if;
  return query select * from _waiver_order(p_league);
end $$;

-- Namen vergleichbar machen: 'POGAČAR Tadej' = 'Tadej Pogacar' (Akzente weg, Wörter sortiert)
create extension if not exists unaccent with schema extensions;
create or replace function norm_name(p text) returns text
language sql immutable parallel safe set search_path = public, extensions as $$
  select array_to_string(array(select w from unnest(regexp_split_to_array(
           lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, ''))), '[^a-z0-9]+')) w
         where w <> '' order by w), ' ');
$$;
create index if not exists athletes_norm_name on athletes (gender, norm_name(name));

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
create or replace function athlete_toplists(p_athlete text)
returns table (year int, discipline text, mark text, score int, rank int)
language sql stable security definer set search_path = public as $$
  select t.year, t.discipline, t.mark, t.score,
         (select count(*) + 1 from toplist_entries o join athletes oa on oa.id = o.athlete_id
           where o.year = t.year and o.discipline = t.discipline and oa.gender = a.gender and o.score > t.score)::int
    from toplist_entries t join athletes a on a.id = t.athlete_id
   where t.athlete_id = p_athlete
   order by t.year desc, t.score desc;
$$;

-- Toplisten-Ansicht: vorhandene Jahre/Disziplinen/Geschlechter und die besten Einträge einer Liste
create or replace function toplist_index()
returns table (year int, discipline text, gender text, entries int)
language sql stable security definer set search_path = public as $$
  select t.year, t.discipline, a.gender, count(*)::int
    from toplist_entries t join athletes a on a.id = t.athlete_id
   group by 1, 2, 3 order by 1 desc, 2, 3;
$$;
create or replace function toplist(p_year int, p_discipline text, p_gender text, p_limit int default 20)
returns table (rank int, athlete_id text, name text, nation text, mark text, score int)
language sql stable security definer set search_path = public as $$
  select (rank() over (order by t.score desc))::int, t.athlete_id, a.name, a.nation, t.mark, t.score
    from toplist_entries t join athletes a on a.id = t.athlete_id
   where t.year = p_year and t.discipline = p_discipline and a.gender = p_gender
   order by t.score desc, a.name limit least(coalesce(p_limit, 20), 200);
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
  update athletes r set pool_rank = x.rk
    from (select id, row_number() over (order by coalesce(group_points, 0) desc, ranking_points desc, name) rk
            from athletes where ranking_points >= c.pool_threshold) x
   where x.id = r.id;
  get diagnostics n = row_count;
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
  (6, 1.3, 'über 3 bis 6 km – wie 3000/5000 m'),
  (12, 1.6, 'über 6 bis 12 km – wie 10.000 m'),
  (1000, 2, 'über 12 km – wie Halbmarathon/25 km Straße')
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

create or replace function rebuild_results(p_from date default null) returns int
language plpgsql security definer set search_path = public as $$
declare c scoring_config; n int;
begin
  select * into c from scoring_config where id = 1;
  delete from results where p_from is null or result_date >= p_from;
  insert into results (athlete_id, competition_id, label, result_date, rank, points, perf_points, placing_points, record_points, wa_result_id)
  select athlete_id, competition_id, label, date, place, perf + plc + rec, perf, plc, rec, id
    from (
      select w.id, w.athlete_id, w.date, w.place,
             -- Staffel: Leistungs- und Platzierungspunkte nur anteilig (1/3 bzw. 1/4)
             case w.record when 'WR' then c.record_wr when 'ER' then c.record_er when 'DR' then c.record_dr else 0 end rec,
             coalesce('wa-c' || w.wa_competition_id, 'wa-' || md5(w.competition || w.date::text)) competition_id,
             w.discipline || case when d.cross_table is not null and cross_km(w.competition) is not null
                                  then ' · ' || cross_km(w.competition) || 'km' else '' end
               || case when w.wa_race in ('', 'F') then '' else ' · ' || w.wa_race end label,
             case when d.cross_table is not null then
                    round(greatest(0, coalesce((select ps.points from placing_scores ps
                                                 where ps.placing_table = d.cross_table and ps.category = w.category
                                                   and ps.race_type = 'F' and ps.place = w.place and _race_type(w.race) = 'F'), 0)
                                      - c.perf_threshold)
                          * c.cross_factor * coalesce(_cross_factor(cross_km(w.competition)), d.factor, 0), 2)
                  else round(greatest(0, coalesce(w.result_score, 0) - c.perf_threshold) * c.perf_factor * coalesce(d.factor, 0)
                             * coalesce(w.share, 1), 2)
             end perf,
             case when d.cross_table is not null then 0
                  else round(coalesce((select max(ps.points) from placing_scores ps
                                        where ps.placing_table = any (d.placing_tables) and ps.category = w.category
                                          and ps.race_type = coalesce(w.placing_round, _race_type(w.race))
                                          and ps.place = coalesce(w.placing_place, w.place)), 0)
                          * c.placing_factor * coalesce(d.factor, 0) * coalesce(w.share, 1), 2)
             end plc
        from wa_results w left join disciplines d on d.name = w.discipline
       where (p_from is null or w.date >= p_from) and w.date >= date '2025-01-01'
         -- Zwischenzeiten (z. B. 1500 m im Meilenrennen) zählen nicht, nur das eigentliche Rennen
         and not _is_split(w.competition, w.remark)
         -- Nachtrag entfällt, sobald World Athletics dasselbe Ergebnis führt (gleiche Disziplin, ±1 Tag)
         and not (w.source = 'manual' and w.relay is null and exists (select 1 from wa_results o
                   where o.athlete_id = w.athlete_id and o.source = 'wa' and o.discipline = w.discipline
                     and abs(o.date - w.date) <= 1))
    ) x
   where perf + plc + rec > 0
  on conflict (athlete_id, competition_id, label) do nothing;
  get diagnostics n = row_count;
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
    record_er      = coalesce((s->>'record_er')::int, record_er),
    record_wr      = coalesce((s->>'record_wr')::int, record_wr),
    game_year      = case when s ? 'game_year' then nullif(s->>'game_year', '')::int else game_year end,
    updated_at     = now()
  where id = 1;
  if exists (select 1 from scoring_config where perf_factor < 0 or placing_factor < 0 or cross_factor < 0
              or record_dr < 0 or record_er < 0 or record_wr < 0) then
    raise exception 'Faktoren und Rekordpunkte dürfen nicht negativ sein.';
  end if;
  perform rebuild_results(null);
  perform refresh_pool(null);   -- Gruppe und Pool-Rang hängen an Punkten, Spieljahr und Schwellen
  insert into admin_log (league_id, user_id, action, details)
    select id, auth.uid(), 'scoring_config', s from leagues where admin_user = auth.uid();
end $$;

-- Rekord an einem Ergebnis markieren (DR/ER/WR) oder entfernen (null) – jeder Liga-Admin; Punkte werden neu berechnet
create or replace function set_result_record(p_id bigint, p_record text) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not exists (select 1 from leagues where admin_user = auth.uid()) and not _is_service() then
    raise exception 'Nur Liga-Admins dürfen Rekorde eintragen.';
  end if;
  if p_record is not null and p_record not in ('DR', 'ER', 'WR') then raise exception 'Unbekannter Rekord: %', p_record; end if;
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
      join wa_results w on w.athlete_id = j.athlete_id and w.discipline = j.discipline and w.date = j.date
                       and mark_seconds(w.mark) = mark_seconds(j.mark)
     where j.record in ('DR', 'ER', 'WR')
     order by w.id, array_position(array['WR', 'ER', 'DR'], j.record))
  update wa_results w set record = x.record from x
   where w.id = x.id and coalesce(array_position(array['DR', 'ER', 'WR'], w.record), 0) < array_position(array['DR', 'ER', 'WR'], x.record);
  get diagnostics n = row_count;
  if n > 0 then
    select min((j->>'date')::date) into d from jsonb_array_elements(p_rows) j;
    perform rebuild_results(d);
    for y in extract(year from d)::int .. extract(year from current_date)::int loop perform refresh_season_stats(y); end loop;
  end if;
  return n;
end $$;

-- Punkte pro Athlet in einem Jahr (für die Athletenliste der App); p_gender 'mixed' = alle
create or replace function athlete_points(p_gender text, p_year int)
returns table (athlete_id text, points numeric, results int)
language sql stable security definer set search_path = public as $$
  select r.athlete_id, sum(r.points), count(*)::int
    from results r join athletes x on x.id = r.athlete_id
   where _gender_ok(p_gender, x.gender)
     and r.result_date >= make_date(p_year, 1, 1) and r.result_date <= make_date(p_year, 12, 31)
   group by r.athlete_id
   order by r.athlete_id;
$$;

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

-- =====================================================================
-- Waiver
-- =====================================================================

create or replace function submit_waiver(p_league uuid, p_add text, p_drop text, p_bid int default 0,
                                         p_immediate boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare l leagues; v_me uuid; v_id uuid; v_budget int;
begin
  v_me := _require_member(p_league);
  select * into l from leagues where id = p_league;
  if l.status <> 'active' then raise exception 'Waiver sind erst nach dem Draft möglich.'; end if;
  if p_drop is null then
    if _open_roster_slots(v_me) <= 0 then raise exception 'Dein Kader ist voll – bitte einen Athleten zum Abgeben wählen.'; end if;
  elsif not exists (select 1 from roster_entries where manager_id = v_me and athlete_id = p_drop and released_on is null) then
    raise exception 'Der abzugebende Athlet ist nicht in deinem Kader.';
  end if;
  if not _athlete_free(p_league, p_add, 'infinity') then raise exception 'Dieser Athlet ist nicht frei.'; end if;
  select budget_left into v_budget from managers where id = v_me;
  if l.waiver_mode = 'faab' and (p_bid < 0 or p_bid > v_budget) then
    raise exception 'Gebot muss zwischen 0 und deinem Restbudget (%) liegen.', v_budget;
  end if;

  if p_immediate then
    -- Ersatz außer der Reihe bei Karriereende/Sperre
    if p_drop is null or not (select inactive from athletes where id = p_drop) then
      raise exception 'Sofort-Ersatz nur für Athleten mit Karriereende oder Sperre.';
    end if;
    if not _athlete_free(p_league, p_add, coalesce(l.last_waiver_run, '-infinity')) then
      raise exception 'Dieser Athlet ist bis zum nächsten Stichtag gesperrt.';
    end if;
    if not _team_limit_ok(v_me, p_add, p_drop) then raise exception 'Grenze pro Team erreicht.'; end if;
    perform _release(p_league, v_me, p_drop, current_date);
    insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
    values (p_league, v_me, p_add, 0, 'waiver', current_date);
    insert into waiver_claims (league_id, manager_id, add_athlete, drop_athlete, status, note, processed_at)
    values (p_league, v_me, p_add, p_drop, 'won', 'Sofort-Ersatz', now()) returning id into v_id;
    return v_id;
  end if;

  insert into waiver_claims (league_id, manager_id, add_athlete, drop_athlete, bid, priority)
  values (p_league, v_me, p_add, p_drop, case when l.waiver_mode = 'faab' then p_bid else 0 end,
          coalesce((select max(priority) from waiver_claims where manager_id = v_me and status = 'pending'), 0) + 1)
  returning id into v_id;
  return v_id;
end $$;

create or replace function cancel_waiver(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update waiver_claims c set status = 'cancelled', processed_at = now()
   where c.id = p_id and c.status = 'pending'
     and c.manager_id in (select id from managers where user_id = auth.uid());
end $$;

create or replace function reorder_waivers(p_league uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_me uuid;
begin
  v_me := _require_member(p_league);
  update waiver_claims c set priority = x.ord
    from unnest(p_ids) with ordinality x(id, ord)
   where c.id = x.id and c.manager_id = v_me and c.status = 'pending';
end $$;

create or replace function _claim_valid(c waiver_claims, l leagues) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if c.drop_athlete is null then
    if _open_roster_slots(c.manager_id) <= 0 then return 'Kader ist voll'; end if;
  elsif not exists (select 1 from roster_entries where manager_id = c.manager_id and athlete_id = c.drop_athlete and released_on is null) then
    return 'Abzugebender Athlet nicht mehr im Kader';
  end if;
  if not _athlete_free(l.id, c.add_athlete, now()) then return 'Athlet schon vergeben'; end if;
  if not _team_limit_ok(c.manager_id, c.add_athlete, c.drop_athlete) then return 'Grenze pro Team'; end if;
  if l.waiver_mode = 'faab' and c.bid > (select budget_left from managers where id = c.manager_id) then
    return 'Restbudget reicht nicht';
  end if;
  return null;
end $$;

create or replace function _execute_claim(c waiver_claims, l leagues, md matchdays) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _release(l.id, c.manager_id, c.drop_athlete, md.starts_on);
  insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
  values (l.id, c.manager_id, c.add_athlete, case when l.waiver_mode = 'faab' then c.bid else 0 end, 'waiver', md.starts_on);
  if l.waiver_mode = 'faab' then
    update managers set budget_left = budget_left - c.bid where id = c.manager_id;
  end if;
  -- steht der abgegebene Athlet in einer Aufstellung ab diesem Spieltag, rückt der neue nach (wenn er passt)
  perform _lineup_swap(l.id, c.manager_id, c.drop_athlete, c.add_athlete, md.starts_on);
  update waiver_claims set status = 'won', processed_at = now(), matchday_id = md.id where id = c.id;
  -- andere Anträge mit demselben abzugebenden Fahrer werden ungültig
  update waiver_claims set status = 'lost', note = 'Abzugebender Athlet schon getauscht', processed_at = now(), matchday_id = md.id
   where manager_id = c.manager_id and status = 'pending' and c.drop_athlete is not null and drop_athlete = c.drop_athlete;
end $$;

-- Phase für den nächsten Spieltag: 'waiver' (Anträge sammeln), 'free' (sofort tauschen), null (kein Spieltag)
create or replace function transfer_phase(p_league uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l leagues; md matchdays;
begin
  select * into l from leagues where id = p_league;
  select * into md from matchdays where league_id = p_league and deadline > now() order by deadline limit 1;
  if not found then return jsonb_build_object('phase', null); end if;
  return jsonb_build_object('matchday', md.id,
    'phase', case when l.transfer_mode = 'waiver_free' and md.waivers_done then 'free' else 'waiver' end,
    'waiver_deadline', coalesce(md.waiver_deadline, md.deadline), 'deadline', md.deadline);
end $$;

-- Freie Phase: freien Fahrer sofort holen und dafür einen abgeben – gilt ab dem nächsten Spieltag
create or replace function free_move(p_league uuid, p_add text, p_drop text) returns void
language plpgsql security definer set search_path = public as $$
declare l leagues; md matchdays; v_me uuid; e roster_entries;
begin
  v_me := _require_member(p_league);
  perform process_due(p_league);
  select * into l from leagues where id = p_league;
  if l.transfer_mode <> 'waiver_free' or l.status <> 'active' then raise exception 'In dieser Liga gibt es keine freie Phase.'; end if;
  select * into md from matchdays where league_id = p_league and deadline > now() order by deadline limit 1;
  if not found or not md.waivers_done then raise exception 'Die freie Phase beginnt erst nach der Waiver-Runde.'; end if;
  if p_drop is null then
    if _open_roster_slots(v_me) <= 0 then raise exception 'Dein Kader ist voll – bitte einen Athleten zum Abgeben wählen.'; end if;
  else
    select * into e from roster_entries where manager_id = v_me and athlete_id = p_drop and released_on is null;
    if not found then raise exception 'Der abzugebende Athlet ist nicht in deinem Kader.'; end if;
  end if;
  -- frei = in keinem Kader für den nächsten Spieltag (abgegebene Fahrer sind sofort wieder frei)
  if exists (select 1 from roster_entries where league_id = p_league and athlete_id = p_add and released_on is null) then
    raise exception 'Dieser Athlet ist schon vergeben.';
  end if;
  if not exists (select 1 from athletes r where r.id = p_add and _gender_ok(l.gender, r.gender) and not r.inactive and r.pool_rank is not null) then
    raise exception 'Athlet nicht verfügbar.';
  end if;
  if not _team_limit_ok(v_me, p_add, p_drop) then raise exception 'Grenze pro Team erreicht.'; end if;
  -- abgeben: erst in dieser Phase geholt → Eintrag entfernen, sonst endet er mit dem Spieltagstart
  if e.id is null then null;
  elsif e.acquired_on >= md.starts_on then
    delete from roster_entries where id = e.id;
  else
    update roster_entries set released_on = md.starts_on, released_at = now() where id = e.id;
  end if;
  -- holen: eigenen, gerade abgegebenen Fahrer zurücknehmen oder neu eintragen
  update roster_entries set released_on = null, released_at = null
   where manager_id = v_me and athlete_id = p_add and released_on = md.starts_on
     and released_at >= coalesce(md.waiver_deadline, md.deadline);
  if not found then
    insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
    values (p_league, v_me, p_add, 0, 'free', md.starts_on);
  end if;
  perform _lineup_swap(p_league, v_me, p_drop, p_add, md.starts_on);
  insert into waiver_claims (league_id, manager_id, add_athlete, drop_athlete, status, note, processed_at, matchday_id)
  values (p_league, v_me, p_add, p_drop, 'won', 'Freie Phase', now(), md.id);
end $$;

-- Nach Wechsel des Transfermodus: Standard-Fristen künftiger Spieltage neu setzen
create or replace function _reset_default_deadlines(p_league uuid, p_old_mode text) returns void
language plpgsql security definer set search_path = public as $$
declare m matchdays;
begin
  for m in select * from matchdays where league_id = p_league and status = 'planned' and not waivers_done
             and coalesce(waiver_deadline, deadline) > now() order by starts_on loop
    -- nur Standardwerte ersetzen, eigene Fristen des Admins bleiben
    if m.deadline in (m.starts_on::timestamp at time zone 'Europe/Berlin',
                      (m.starts_on - 1 + time '20:00')::timestamp at time zone 'Europe/Berlin') then
      update matchdays set deadline = _default_deadline(p_league, m.starts_on) where id = m.id;
    end if;
    update matchdays set waiver_deadline = _default_waiver_deadline(p_league, m.starts_on, m.id) where id = m.id;
  end loop;
end $$;

create or replace function _process_waivers(p_md uuid) returns void
language plpgsql security definer set search_path = public as $$
declare md matchdays; l leagues; v_order uuid[]; v_mgr uuid; c waiver_claims; v_why text;
        v_success boolean; v_best waiver_claims; v_best_idx int; i int;
begin
  select * into md from matchdays where id = p_md;
  select * into l from leagues where id = md.league_id;
  select array_agg(w.manager_id order by w.waiver_pos) into v_order from _waiver_order(l.id) w;

  loop
    v_success := false;
    v_best := null; v_best_idx := null;
    for i in 1 .. coalesce(array_length(v_order, 1), 0) loop
      v_mgr := v_order[i];
      -- obersten gültigen Antrag dieses Managers suchen
      c := null;
      for c in select * from waiver_claims
                where manager_id = v_mgr and status = 'pending' and created_at <= coalesce(md.waiver_deadline, md.deadline)
                order by priority, created_at loop
        v_why := _claim_valid(c, l);
        if v_why is null then exit; end if;
        update waiver_claims set status = 'lost', note = v_why, processed_at = now(), matchday_id = md.id where id = c.id;
        c := null;
      end loop;
      if c.id is null then continue; end if;

      if l.waiver_mode = 'priority' then
        perform _execute_claim(c, l, md);       -- ein Zuschlag pro Runde und Manager
        v_success := true;
      elsif v_best.id is null or c.bid > v_best.bid then
        v_best := c; v_best_idx := i;           -- FAAB: Höchstgebot, bei Gleichstand der schlechter Platzierte
      end if;
    end loop;

    if l.waiver_mode = 'faab' and v_best.id is not null then
      perform _execute_claim(v_best, l, md);
      v_success := true;
    end if;
    exit when not v_success;
  end loop;
end $$;

-- =====================================================================
-- Tausch zwischen Managern
-- =====================================================================

-- Freie Kaderplätze eines Managers
create or replace function _open_roster_slots(p_manager uuid) returns int
language sql stable security definer set search_path = public as $$
  select l.roster_size - (select count(*) from roster_entries re where re.manager_id = m.id and re.released_on is null)::int
    from managers m join leagues l on l.id = m.league_id where m.id = p_manager;
$$;

-- Prüft Fahrer, die ein Manager im Tausch zusätzlich entlässt: im Kader, nicht Teil des Tauschs,
-- nicht schon in einem offenen Waiver-Antrag zur Abgabe vorgesehen
create or replace function _check_trade_drops(p_manager uuid, p_drop text[], p_trade_riders text[], p_needed int) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(array_length(p_drop, 1), 0) <> p_needed then
    raise exception 'Bitte genau % Athleten zum Entlassen auswählen, damit der Kader nicht zu groß wird.', p_needed;
  end if;
  if p_needed = 0 then return; end if;
  if (select count(distinct x) from unnest(p_drop) x) <> p_needed or p_drop && p_trade_riders then
    raise exception 'Zu entlassende Athleten dürfen nicht Teil des Tauschs sein.';
  end if;
  if (select count(*) from roster_entries where manager_id = p_manager and released_on is null and athlete_id = any (p_drop)) <> p_needed then
    raise exception 'Zu entlassende Athleten müssen im eigenen Kader stehen.';
  end if;
  if exists (select 1 from waiver_claims where manager_id = p_manager and status = 'pending' and drop_athlete = any (p_drop)) then
    raise exception 'Ein Athlet ist schon in einem offenen Waiver-Antrag zur Abgabe vorgesehen.';
  end if;
end $$;

drop function if exists propose_trade(uuid, uuid, text[], text[]);
create or replace function propose_trade(p_league uuid, p_to uuid, p_give text[], p_take text[], p_drop text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid; v uuid; n_give int := coalesce(array_length(p_give, 1), 0); n_take int := coalesce(array_length(p_take, 1), 0);
begin
  v_me := _require_member(p_league);
  if (select status from leagues where id = p_league) <> 'active' then raise exception 'Tausch erst nach dem Draft.'; end if;
  if p_to = v_me or not exists (select 1 from managers where id = p_to and league_id = p_league) then
    raise exception 'Ungültiger Tauschpartner.';
  end if;
  if n_give = 0 or n_take = 0 then raise exception 'Beide Seiten müssen mindestens einen Athleten abgeben.'; end if;
  if (select count(*) from roster_entries where manager_id = v_me and released_on is null and athlete_id = any (p_give)) <> n_give
     or (select count(*) from roster_entries where manager_id = p_to and released_on is null and athlete_id = any (p_take)) <> n_take then
    raise exception 'Die Athleten müssen in den jeweiligen Kadern stehen.';
  end if;
  -- bekomme ich mehr Fahrer als ich abgebe, entlasse ich die Differenz
  perform _check_trade_drops(v_me, coalesce(p_drop, '{}'), p_give, greatest(n_take - n_give - _open_roster_slots(v_me), 0));
  insert into trades (league_id, from_manager, to_manager, give_athletes, take_athletes, from_drop)
  values (p_league, v_me, p_to, p_give, p_take, coalesce(p_drop, '{}')) returning id into v;
  perform _notify(p_to, '🔁 Neues Tauschangebot',
    (select team_name from managers where id = v_me) || ' bietet ' ||
    (select string_agg(_rname(x), ', ') from unnest(p_give) x) || ' für ' || (select string_agg(_rname(x), ', ') from unnest(p_take) x),
    '#/league/' || p_league || '/team');
  return v;
end $$;

drop function if exists respond_trade(uuid, boolean);
create or replace function respond_trade(p_trade uuid, p_accept boolean, p_drop text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare t trades;
begin
  select * into t from trades where id = p_trade for update;
  if not found or t.status <> 'proposed' then raise exception 'Kein offenes Angebot.'; end if;
  if t.to_manager <> my_manager(t.league_id) then raise exception 'Dieses Angebot ist nicht an dich.'; end if;
  if p_accept then
    -- bekomme ich mehr Fahrer als ich abgebe, entlasse ich die Differenz
    perform _check_trade_drops(t.to_manager, coalesce(p_drop, '{}'), t.take_athletes,
      greatest(array_length(t.give_athletes, 1) - array_length(t.take_athletes, 1) - _open_roster_slots(t.to_manager), 0));
  end if;
  update trades set status = case when p_accept then 'accepted' else 'declined' end,
                    accepted_at = case when p_accept then now() end,
                    to_drop = case when p_accept then coalesce(p_drop, '{}') else to_drop end
   where id = p_trade;
  perform _notify(t.from_manager, case when p_accept then '✅ Tausch angenommen' else '❌ Tausch abgelehnt' end,
    (select team_name from managers where id = t.to_manager) || case when p_accept
      then ' hat zugestimmt. Ausgeführt wird zum nächsten Stichtag.' else ' hat abgelehnt.' end,
    '#/league/' || t.league_id || '/team');
end $$;

create or replace function cancel_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t trades;
begin
  select * into t from trades where id = p_trade for update;
  if t.from_manager <> my_manager(t.league_id) then raise exception 'Nicht dein Angebot.'; end if;
  update trades set status = 'cancelled' where id = p_trade and status in ('proposed', 'accepted');
end $$;

create or replace function veto_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t trades;
begin
  select * into t from trades where id = p_trade for update;
  perform _require_admin(t.league_id);
  if t.status <> 'accepted' or now() > t.accepted_at + interval '24 hours' then
    raise exception 'Veto nur innerhalb von 24 Stunden nach Zustimmung.';
  end if;
  update trades set status = 'vetoed' where id = p_trade;
  perform _log(t.league_id, 'veto_trade', jsonb_build_object('trade', p_trade));
end $$;

-- Angenommene Tauschs werden zum nächsten Stichtag nach Ablauf der Vetofrist ausgeführt
create or replace function _process_trades(p_md uuid) returns void
language plpgsql security definer set search_path = public as $$
declare md matchdays; t trades; r text;
begin
  select * into md from matchdays where id = p_md;
  for t in select * from trades where league_id = md.league_id and status = 'accepted'
                                  and accepted_at + interval '24 hours' <= md.deadline order by accepted_at loop
    if (select count(*) from roster_entries where manager_id = t.from_manager and released_on is null
          and athlete_id = any (t.give_athletes || t.from_drop)) <> coalesce(array_length(t.give_athletes || t.from_drop, 1), 0)
       or (select count(*) from roster_entries where manager_id = t.to_manager and released_on is null
          and athlete_id = any (t.take_athletes || t.to_drop)) <> coalesce(array_length(t.take_athletes || t.to_drop, 1), 0) then
      update trades set status = 'failed', note = 'Athlet nicht mehr im Kader', done_at = now() where id = t.id;
      continue;
    end if;
    -- zusätzlich entlassene Fahrer werden frei
    foreach r in array t.from_drop loop perform _release(md.league_id, t.from_manager, r, md.starts_on); end loop;
    foreach r in array t.to_drop loop perform _release(md.league_id, t.to_manager, r, md.starts_on); end loop;
    foreach r in array t.give_athletes loop
      perform _release(md.league_id, t.from_manager, r, md.starts_on);
      insert into roster_entries (league_id, manager_id, athlete_id, source, acquired_on) values (md.league_id, t.to_manager, r, 'trade', md.starts_on);
    end loop;
    foreach r in array t.take_athletes loop
      perform _release(md.league_id, t.to_manager, r, md.starts_on);
      insert into roster_entries (league_id, manager_id, athlete_id, source, acquired_on) values (md.league_id, t.from_manager, r, 'trade', md.starts_on);
    end loop;
    update trades set status = 'done', done_at = now() where id = t.id;
  end loop;
end $$;

-- =====================================================================
-- Stichtage und Spieltags-Status
-- =====================================================================

-- Arbeitet alle fälligen Stichtage ab (Tausch, Waiver, Wertungsmodus übernehmen).
-- Darf jeder angemeldete Nutzer aufrufen; die App tut das beim Öffnen.
create or replace function process_due(p_league uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare md matchdays; n int := 0;
begin
  for md in select m.* from matchdays m join leagues l on l.id = m.league_id
             where ((not m.waivers_done and coalesce(m.waiver_deadline, m.deadline) <= now())
                    or (not m.locked and m.deadline <= now()))
               and l.status = 'active' and (p_league is null or m.league_id = p_league)
             order by m.deadline
             for update of m skip locked loop
    -- Stichtag: Tausche ausführen, Wertungsmodus festhalten, Kader und Aufstellung sind ab jetzt fest
    if not md.locked and md.deadline <= now() then
      update matchdays m set scoring_mode = l.scoring_mode, lineup_size = l.lineup_size
        from leagues l where l.id = m.league_id and m.id = md.id;
      perform _process_trades(md.id);
    end if;
    -- Waiver-Runde (im zweiteiligen Modus vor dem Stichtag, danach beginnt die freie Phase)
    if not md.waivers_done and coalesce(md.waiver_deadline, md.deadline) <= now() then
      perform _process_waivers(md.id);
      perform _notify(w.manager_id, '📋 Waiver-Ergebnis',
          coalesce('Zuschlag: ' || string_agg(_rname(w.add_athlete), ', ') filter (where w.status = 'won'), 'Kein Zuschlag')
          || coalesce(' · ohne Zuschlag: ' || string_agg(_rname(w.add_athlete), ', ') filter (where w.status = 'lost'), ''),
          '#/league/' || md.league_id || '/waiver')
         from waiver_claims w where w.matchday_id = md.id and w.processed_at >= now() - interval '1 minute'
         group by w.manager_id;
      update matchdays set waivers_done = true where id = md.id;
      update leagues set last_waiver_run = now() where id = md.league_id;
    end if;
    if md.deadline <= now() then update matchdays set locked = true where id = md.id; end if;
    n := n + 1;
  end loop;
  update matchdays set status = 'running'
   where status = 'planned' and starts_on <= current_date and (p_league is null or league_id = p_league);
  return n;
end $$;

-- Täglich nach dem Ergebnisabruf (nur Service-Key): Spieltage abschließen und
-- 7 Tage nach Abschluss einfrieren.
create or replace function run_maintenance() returns void
language plpgsql security definer set search_path = public as $$
declare md matchdays;
begin
  perform process_due(null);
  for md in update matchdays set status = 'closed', closed_at = now() where status = 'running' and ends_on < current_date
             returning * loop
    perform _notify(t.manager_id, '🏁 ' || md.name || ' abgeschlossen',
        coalesce((select round(sum(p.points), 1)::text from _league_points(md.league_id) p
                   where p.matchday_id = md.id and p.manager_id = t.manager_id), '0')
        || ' Punkte · Gesamt Platz ' || t."position", '#/league/' || md.league_id || '/table')
       from _league_table(md.league_id) t;
  end loop;
  for md in select * from matchdays where status = 'closed' and not frozen and closed_at <= now() - interval '7 days' loop
    insert into score_snapshot (league_id, matchday_id, manager_id, athlete_id, competition_id, label, result_date, points)
      select md.league_id, s.matchday_id, s.manager_id, s.athlete_id, s.competition_id, s.label, s.result_date, s.points
        from _score_rows(md.league_id) s where s.matchday_id = md.id;
    update matchdays set frozen = true where id = md.id;
  end loop;
  update leagues set status = 'finished' where status = 'active' and season_end < current_date;
  update sync_status set last_run = now(), ok = true, message = null where id = 1;
end $$;

-- =====================================================================
-- Nachträge: Ergebnisse, die World Athletics nicht führt (z. B. von RaceResult), mit WA-Punkten
-- =====================================================================

-- "2:09:43" / "29:18" / "13:45.12" / "29:18,4" -> Sekunden
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
  select case when mark_seconds(p_mark) is null then null
              -- jenseits des Tiefpunkts der Parabel (sehr langsam) gibt es 0 Punkte
              when mark_seconds(p_mark) >= -k.b / (2 * k.a) then 0
              else greatest(0, round(k.a * mark_seconds(p_mark)^2 + k.b * mark_seconds(p_mark) + k.c))::int end
    from scoring_coefficients k where k.discipline = p_discipline and k.gender = p_gender;
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

-- =====================================================================
-- Admin-Werkzeuge
-- =====================================================================

create or replace function admin_set_override(p_league uuid, p_matchday uuid, p_manager uuid, p_rider text,
                                              p_points numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin(p_league);
  if coalesce(trim(p_reason), '') = '' then raise exception 'Bitte einen Grund angeben.'; end if;
  if p_points is null then
    delete from point_overrides where matchday_id = p_matchday and manager_id = p_manager and athlete_id = p_rider;
  else
    insert into point_overrides (league_id, matchday_id, manager_id, athlete_id, points, reason, created_by)
    values (p_league, p_matchday, p_manager, p_rider, p_points, p_reason, auth.uid())
    on conflict (matchday_id, manager_id, athlete_id)
    do update set points = excluded.points, reason = excluded.reason, created_by = excluded.created_by, created_at = now();
  end if;
  perform _log(p_league, 'override', jsonb_build_object('matchday', p_matchday, 'manager', p_manager,
               'rider', p_rider, 'points', p_points, 'reason', p_reason));
end $$;

-- Kader korrigieren (sofort wirksam, wird protokolliert)
create or replace function admin_roster_fix(p_league uuid, p_manager uuid, p_add text, p_drop text,
                                            p_price int default 0, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin(p_league);
  if p_drop is not null and not _release(p_league, p_manager, p_drop, current_date) then
    raise exception 'Athlet % ist nicht im Kader.', p_drop;
  end if;
  if p_add is not null then
    if not _athlete_free(p_league, p_add, 'infinity') then raise exception 'Athlet % ist nicht frei.', p_add; end if;
    if _open_slots(p_manager) <= 0 then raise exception 'Der Kader ist voll.'; end if;
    insert into roster_entries (league_id, manager_id, athlete_id, price, source, acquired_on)
    values (p_league, p_manager, p_add, coalesce(p_price, 0), 'admin', current_date);
  end if;
  perform _log(p_league, 'roster_fix', jsonb_build_object('manager', p_manager, 'add', p_add, 'drop', p_drop, 'reason', p_reason));
end $$;

create or replace function admin_mark_inactive(p_league uuid, p_rider text, p_inactive boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_admin(p_league);
  update athletes set inactive = p_inactive where id = p_rider;
  perform _log(p_league, 'mark_inactive', jsonb_build_object('rider', p_rider, 'inactive', p_inactive));
end $$;

-- =====================================================================
-- Zeitplaner (pg_cron): startet die GitHub-Abläufe zu deutschen Uhrzeiten
-- Der GitHub-Schlüssel liegt verschlüsselt im Supabase Vault ("github_dispatch_token").
-- =====================================================================

do $$ begin
  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron;
exception when others then raise notice 'pg_net/pg_cron nicht verfügbar: %', sqlerrm;   -- z. B. lokale Testdatenbank
end $$;

create or replace function dispatch_workflow(p_file text, p_inputs jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text; v_id bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if v_token is null then
    raise warning 'Kein github_dispatch_token im Vault – Ablauf % nicht gestartet', p_file;
    return null;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/Schubidu93/FantasyAthletics/actions/workflows/' || p_file || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', coalesce(p_inputs, '{}'::jsonb)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_token, 'Accept', 'application/vnd.github+json',
                                  'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'fantasy-athletics-scheduler',
                                  'Content-Type', 'application/json')) into v_id;
  return v_id;
end $$;

-- ---- Feedback ---------------------------------------------------------------------------
-- Nutzer schicken Text und Bilder; der Ablauf "Feedback senden" (feedback.yml) mailt sie an den Betreiber.
-- Bilder liegen nur bis zum Versand in der Datenbank.
create table if not exists feedback (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users (id) on delete set null,
  user_email text,
  league_id  uuid references leagues (id) on delete set null,
  league_name text,
  team_name  text,
  page       text,
  device     text,
  message    text not null,
  attempts   int  not null default 0,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists feedback_images (
  id          bigint generated always as identity primary key,
  feedback_id bigint not null references feedback (id) on delete cascade,
  mime        text not null,
  data        bytea not null
);
alter table feedback enable row level security;
alter table feedback_images enable row level security;   -- nur der Service-Key liest (Versand)

-- p_images: [{"mime": "image/jpeg", "data": "<base64>"}, …] (höchstens 5, je höchstens 2 MB)
drop function if exists submit_feedback(text, uuid, text, text, jsonb);
create or replace function submit_feedback(p_message text, p_league uuid, p_page text, p_device text, p_images jsonb default '[]')
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare v_id bigint; v_img jsonb; v_data bytea;
begin
  if auth.uid() is null then raise exception 'Bitte zuerst anmelden.'; end if;
  if coalesce(btrim(p_message), '') = '' and jsonb_array_length(coalesce(p_images, '[]')) = 0 then
    raise exception 'Bitte schreib etwas oder hänge ein Bild an.';
  end if;
  if length(p_message) > 5000 then raise exception 'Der Text ist zu lang (max. 5000 Zeichen).'; end if;
  if jsonb_array_length(coalesce(p_images, '[]')) > 5 then raise exception 'Höchstens 5 Bilder.'; end if;
  if (select count(*) from feedback where user_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Heute wurde schon sehr viel Feedback geschickt – bitte morgen wieder.';
  end if;
  insert into feedback (user_id, user_email, league_id, league_name, team_name, page, device, message)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_league,
          (select name from leagues where id = p_league and is_member(id)),
          (select team_name from managers where league_id = p_league and user_id = auth.uid()),
          left(p_page, 200), left(p_device, 300), coalesce(btrim(p_message), ''))
  returning id into v_id;
  for v_img in select * from jsonb_array_elements(coalesce(p_images, '[]')) loop
    if coalesce(v_img->>'mime', '') not in ('image/jpeg', 'image/png', 'image/webp') then raise exception 'Nur Bilder (JPG, PNG).'; end if;
    v_data := decode(v_img->>'data', 'base64');
    if length(v_data) > 2 * 1024 * 1024 then raise exception 'Ein Bild ist zu groß (max. 2 MB).'; end if;
    insert into feedback_images (feedback_id, mime, data) values (v_id, v_img->>'mime', v_data);
  end loop;
  begin
    perform dispatch_workflow('feedback.yml');
  exception when others then null;    -- ohne Token: Versand beim nächsten Zeitplaner-Lauf
  end;
  return v_id;
end $$;

-- läuft alle 15 Minuten
-- Wochen-Zusammenfassung (montags): Punkte der letzten 7 Tage, Tabellenplatz, bester Fahrer – je Manager mit Push
-- Draft-Report: bestmögliche Punkte jedes Kaders im Vorjahr – je Spieltag (Zeitraum ein Jahr früher) die besten
-- x der y gedrafteten Fahrer (x = wertende Fahrer laut Einstellung, y = Kadergröße). Ergebnis wird zwischengespeichert.
create table if not exists draft_projection (
  league_id  uuid not null references leagues (id) on delete cascade,
  manager_id uuid not null references managers (id) on delete cascade,
  points     numeric not null,
  per_md     jsonb not null default '{}',
  signature  text not null,          -- Spieltage + Wertungsmodus; ändert sich etwas, wird neu gerechnet
  computed_at timestamptz not null default now(),
  primary key (league_id, manager_id)
);
alter table draft_projection enable row level security;
drop policy if exists draft_projection_read on draft_projection;
create policy draft_projection_read on draft_projection for select using (is_member(league_id));

create or replace function draft_projection(p_league uuid)
returns table (manager_id uuid, points numeric, per_md jsonb)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare l leagues; v_x int; v_sig text;
begin
  if not is_member(p_league) then raise exception 'Keine Berechtigung.'; end if;
  select * into l from leagues where id = p_league;
  v_x := case when l.scoring_mode = 'lineup' then coalesce(l.lineup_size, l.roster_size) else l.roster_size end;
  v_sig := v_x || '|' || coalesce((select string_agg(starts_on || '-' || ends_on, ',' order by starts_on)
                                   from matchdays where league_id = p_league), 'jahr')
           || '|' || (select count(*) from draft_lots dl where dl.league_id = p_league and dl.manager_id is not null);
  if not exists (select 1 from draft_projection d where d.league_id = p_league and d.signature = v_sig) then
    delete from draft_projection d where d.league_id = p_league;
    insert into draft_projection (league_id, manager_id, points, per_md, signature)
    with team as (
      select distinct d.manager_id, d.athlete_id from draft_lots d where d.league_id = p_league and d.manager_id is not null),
    mds as (   -- Spieltage ein Jahr früher; ohne Spieltage: die ganze Vorsaison als ein Block
      select m.name, (m.starts_on - interval '1 year')::date s, (m.ends_on - interval '1 year')::date e
        from matchdays m where m.league_id = p_league
      union all
      select 'Vorjahr', make_date(extract(year from l.season_start)::int - 1, 1, 1), make_date(extract(year from l.season_start)::int - 1, 12, 31)
       where not exists (select 1 from matchdays where league_id = p_league)),
    rp as (
      select t.manager_id, md.name, t.athlete_id, sum(r.points) p
        from team t cross join mds md
        join results r on r.athlete_id = t.athlete_id and r.result_date between md.s and md.e
       group by 1, 2, 3),
    best as (
      select rp.manager_id, rp.name, sum(rp.p) p from (
        select rp.*, row_number() over (partition by rp.manager_id, rp.name order by rp.p desc) rn from rp) rp
       where rn <= v_x group by 1, 2)
    select p_league, mg.id, coalesce(sum(b.p), 0), coalesce(jsonb_object_agg(b.name, round(b.p, 2)) filter (where b.name is not null), '{}'), v_sig
      from managers mg left join best b on b.manager_id = mg.id
     where mg.league_id = p_league group by mg.id;
  end if;
  return query select d.manager_id, d.points, d.per_md from draft_projection d where d.league_id = p_league;
end $$;

create or replace function weekly_summary() returns int
language plpgsql security definer set search_path = public as $$
declare lg leagues; n int := 0; k int;
begin
  for lg in select * from leagues where status = 'active' loop
    with week as (
      select s.manager_id, s.athlete_id, sum(s.points) pts
        from _score_rows(lg.id) s where s.result_date > current_date - 7 group by 1, 2),
    per_mgr as (
      select manager_id, sum(pts) total,
             (array_agg(athlete_id order by pts desc))[1] best_rider, max(pts) best_pts
        from week group by 1)
    insert into notifications (user_id, title, body, url)
    select m.user_id,
           '📊 Deine Woche: +' || round(coalesce(p.total, 0), 1)::text || ' Punkte',
           lg.name || ': Platz ' || t."position" || ' von ' || (select count(*) from managers where league_id = lg.id)
             || coalesce(' · bester Athlet ' || _rname(p.best_rider) || ' (+' || round(p.best_pts, 1)::text || ')', ' · diese Woche keine Punkte'),
           '#/league/' || lg.id || '/home'
      from managers m
      join _league_table(lg.id) t on t.manager_id = m.id
      left join per_mgr p on p.manager_id = m.id
     where m.league_id = lg.id and m.user_id is not null
       and exists (select 1 from push_subscriptions x where x.user_id = m.user_id)
       -- nur während der Saison mit laufendem oder gerade beendetem Spieltag
       and exists (select 1 from matchdays md where md.league_id = lg.id
                     and md.starts_on <= current_date and md.ends_on >= current_date - 7);
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;

create or replace function scheduler_tick() returns void
language plpgsql security definer set search_path = public as $$
declare t timestamp := now() at time zone 'Europe/Berlin';
        h int := extract(hour from t); m int := extract(minute from t);
begin
  begin
    perform process_due(null);                     -- Stichtage (Waiver, Tausch) pünktlich abarbeiten
  exception when others then raise warning 'process_due: %', sqlerrm;
  end;
  if m < 15 then
    if h = 6 then perform dispatch_workflow('import-athletes.yml'); end if;          -- Athletenpool aus den DE-Toplisten
    -- Ergebnisse: stündlich neue Ergebnisse (Sammelabruf), nachts neue Athleten, Kader und ein Siebtel des Pools komplett
    if h between 8 and 23 then perform dispatch_workflow('import-results.yml', '{"modus": "neu"}'); end if;
    if h = 3 then perform dispatch_workflow('import-results.yml', '{"modus": "nacht"}'); end if;
    if h = 9 and extract(isodow from t) = 1 then perform weekly_summary(); end if;   -- Wochen-Zusammenfassung (Mo)
  end if;
  if exists (select 1 from notifications where sent_at is null) then
    perform dispatch_workflow('push.yml');
  end if;
  -- Feedback, das noch nicht verschickt ist (höchstens 3 Versuche, z. B. solange der Mailzugang fehlt)
  if exists (select 1 from feedback where sent_at is null and attempts < 3 and created_at < now() - interval '5 minutes') then
    perform dispatch_workflow('feedback.yml');
  end if;
end $$;

do $$ begin
  perform cron.schedule('fantasy-athletics-tick', '*/15 * * * *', 'select public.scheduler_tick()');
exception when others then raise notice 'Zeitplan nicht angelegt: %', sqlerrm;
end $$;

-- =====================================================================
-- Rechte
-- =====================================================================

alter table athletes          enable row level security;
alter table competitions           enable row level security;
alter table athlete_season_stats enable row level security;
alter table results         enable row level security;
alter table sync_status     enable row level security;
alter table leagues         enable row level security;
alter table managers        enable row level security;
alter table draft_state     enable row level security;
alter table draft_lots      enable row level security;
alter table draft_bids      enable row level security;
alter table roster_entries  enable row level security;
alter table matchdays       enable row level security;
alter table lineups         enable row level security;
alter table waiver_claims   enable row level security;
alter table trades          enable row level security;
alter table point_overrides enable row level security;
alter table score_snapshot  enable row level security;
alter table admin_log       enable row level security;
alter table toplist_entries enable row level security;
alter table wa_results      enable row level security;
alter table disciplines     enable row level security;
alter table placing_scores  enable row level security;
alter table scoring_config  enable row level security;
alter table cross_distance_factors enable row level security;
alter table keepers         enable row level security;
alter table app_config      enable row level security;   -- keine Policies: nur Service-Key
alter table scoring_coefficients enable row level security;
alter table calendar_events enable row level security;
alter table athlete_sync    enable row level security;   -- keine Policies: nur Service-Key
alter table athlete_feed    enable row level security;   -- keine Policies: nur Service-Key
alter table push_subscriptions enable row level security;
alter table notifications   enable row level security;

do $$
declare t text;
begin
  -- öffentliche Stammdaten: lesbar für angemeldete Nutzer
  foreach t in array array['athletes', 'competitions', 'results', 'sync_status', 'athlete_season_stats', 'toplist_entries',
                           'wa_results', 'disciplines', 'placing_scores', 'scoring_config', 'cross_distance_factors', 'scoring_coefficients',
                           'calendar_events'] loop
    execute format('drop policy if exists read_all on %I', t);
    execute format('create policy read_all on %I for select to authenticated using (true)', t);
  end loop;
  -- Ligadaten: nur für Mitglieder
  foreach t in array array['managers', 'draft_state', 'draft_lots', 'draft_bids', 'roster_entries',
                           'matchdays', 'trades', 'point_overrides', 'score_snapshot', 'admin_log', 'keepers'] loop
    execute format('drop policy if exists members_read on %I', t);
    execute format('create policy members_read on %I for select to authenticated using (is_member(league_id))', t);
  end loop;
end $$;

drop policy if exists members_read on leagues;
create policy members_read on leagues for select to authenticated using (is_member(id));

drop policy if exists members_read on lineups;
create policy members_read on lineups for select to authenticated
  using (exists (select 1 from matchdays m where m.id = matchday_id and is_member(m.league_id)));

-- Blind-Auktion: verdeckte Gebote sieht nur der Bieter selbst (offengelegt werden sie in draft_bids)
alter table draft_sealed enable row level security;
drop policy if exists own_read on draft_sealed;
create policy own_read on draft_sealed for select to authenticated using (manager_id = my_manager(league_id));

-- Waiver-Anträge: eigene immer, fremde erst nach Abwicklung (Gebote bleiben verdeckt)
drop policy if exists members_read on waiver_claims;
create policy members_read on waiver_claims for select to authenticated
  using (is_member(league_id) and (status <> 'pending' or manager_id = my_manager(league_id)));

drop policy if exists own_read on push_subscriptions;
create policy own_read on push_subscriptions for select to authenticated using (user_id = auth.uid());
drop policy if exists own_read on notifications;
create policy own_read on notifications for select to authenticated using (user_id = auth.uid());

-- interne Funktionen nicht direkt aufrufbar
do $$
declare f text;
begin
  foreach f in array array[
    '_require_member(uuid)', '_require_admin(uuid)', '_log(uuid,text,jsonb)', '_open_slots(uuid)',
    '_max_bid(uuid)', '_team_limit_ok(uuid,text,text)', '_athlete_free(uuid,text,timestamptz)',
    '_release(uuid,uuid,text,date)', '_draft_next(uuid)', '_draft_award(uuid,uuid,int)', '_blind_resolve(uuid)', '_start_draft(uuid)', 'refresh_pool(int)', 'rebuild_results(date)',
    'dispatch_workflow(text,jsonb)', 'refresh_season_stats(int)', '_lineup_swap(uuid,uuid,text,text,date)', 'weekly_summary()', 'scheduler_tick()', '_notify(uuid,text,text,text)', '_notify_turn(uuid,uuid,uuid,text,timestamptz)', '_check_trade_drops(uuid,text[],text[],int)', '_open_roster_slots(uuid)', '_reset_default_deadlines(uuid,text)', '_snake_pick(uuid,text)', '_score_rows(uuid)',
    '_claim_valid(waiver_claims,leagues)', '_execute_claim(waiver_claims,leagues,matchdays)',
    '_process_waivers(uuid)', '_process_trades(uuid)', '_league_points(uuid)', '_league_table(uuid)',
    '_waiver_order(uuid)', 'run_maintenance()', 'fit_scoring_coefficients(int)', 'apply_records(jsonb)'] loop
    execute format('revoke execute on function %s from public', f);
    begin
      execute format('revoke execute on function %s from anon, authenticated', f);
    exception when undefined_object then null;  -- Rollen gibt es nur in Supabase
    end;
  end loop;
end $$;

-- Live-Updates im Draft-Raum
do $$
begin
  alter publication supabase_realtime add table draft_state;
exception when duplicate_object or undefined_object then null;
end $$;

-- Saisonwertungen beim Einspielen aufbauen (bzw. aktualisieren)
select refresh_season_stats(y) from generate_series(2025, extract(year from current_date)::int) y;
