import { DraftBoard } from "@/components/DraftBoard";
import { getSeasonContext } from "@/lib/season";
import type { PoolAthlete } from "@/lib/types";

export default async function DraftPage({ params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  const { supabase, season, members, me, isAdmin } = await getSeasonContext(seasonId);

  const [{ data: state }, { data: picks }, { data: pool }] = await Promise.all([
    supabase.rpc("draft_state", { p_season: season.id }).maybeSingle<{
      next_pick_no: number; total_picks: number; member_id: number | null; round: number; finished: boolean;
    }>(),
    supabase.from("draft_picks").select("pick_no, member_id, athlete_id").eq("season_id", season.id).order("pick_no"),
    supabase.from("pool_overview").select("id, name, gender, event_group, best_discipline, best_mark, best_score, owner_member_id")
      .eq("season_id", season.id).order("best_score", { ascending: false }).limit(2000).returns<PoolAthlete[]>(),
  ]);

  return (
    <DraftBoard
      season={season}
      members={members}
      meId={me?.id ?? null}
      isAdmin={isAdmin}
      state={state ?? null}
      picks={(picks ?? []).map((p) => ({ ...p, athlete_id: Number(p.athlete_id) }))}
      pool={(pool ?? []).map((a) => ({ ...a, id: Number(a.id) }))}
    />
  );
}
