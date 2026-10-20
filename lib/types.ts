export type SeasonStatus = "setup" | "drafting" | "active" | "finished";

export type Season = {
  id: number;
  year: number;
  name: string;
  join_code: string;
  status: SeasonStatus;
  created_by: string | null;
  pool_threshold: number;
  perf_threshold: number;
  perf_factor: number;
  placing_factor: number;
  cross_factor: number;
  roster_size: number;
  lineup_slots: string[];
  draft_starts_at: string | null;
};

export type Member = {
  id: number;
  season_id: number;
  user_id: string;
  team_name: string;
  draft_position: number | null;
};

export type Matchday = { id: number; season_id: number; number: number; starts_on: string; ends_on: string };

export type Athlete = {
  id: number;
  name: string;
  gender: "M" | "W" | null;
  birth_year: number | null;
  event_group: string | null;
  best_discipline: string | null;
  best_mark: string | null;
  best_score: number | null;
  retired: boolean;
};

export type PoolAthlete = Athlete & {
  season_id: number;
  owner_member_id: number | null;
  owner_team: string | null;
  season_points: number;
  season_results: number;
  last_result: string | null;
};

export type ResultPoints = {
  result_id: number;
  athlete_id: number;
  date: string;
  competition: string;
  discipline: string;
  category: string | null;
  race: string;
  place: number | null;
  wa_race: string;
  wa_place: number | null;
  placing_round: "F" | "P9" | "P10" | null;
  placing_place: number | null;
  mark: string | null;
  result_score: number | null;
  performance_points: number;
  placing_points: number;
  total_points: number;
};
