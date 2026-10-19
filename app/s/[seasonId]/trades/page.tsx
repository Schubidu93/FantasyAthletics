import { TradeCenter } from "@/components/TradeCenter";
import { getSeasonContext } from "@/lib/season";

export default async function TradesPage({ params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  const { supabase, season, members, me } = await getSeasonContext(seasonId);

  const [{ data: trades }, { data: rosters }] = await Promise.all([
    supabase.from("trades").select("*").eq("season_id", season.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("current_rosters").select("id, name, event_group, member_id").eq("season_id", season.id).order("name"),
  ]);
  const tradeIds = (trades ?? []).map((t) => t.id);
  const { data: items } = tradeIds.length
    ? await supabase.from("trade_items").select("trade_id, athlete_id, from_member_id").in("trade_id", tradeIds)
    : { data: [] };
  const athleteIds = [...new Set((items ?? []).map((i) => i.athlete_id))];
  const { data: names } = athleteIds.length
    ? await supabase.from("athletes").select("id, name").in("id", athleteIds)
    : { data: [] };

  return (
    <TradeCenter
      seasonId={season.id}
      active={season.status === "active"}
      meId={me?.id ?? null}
      members={members}
      trades={trades ?? []}
      items={(items ?? []).map((i) => ({ ...i, athlete_id: Number(i.athlete_id) }))}
      athleteNames={Object.fromEntries((names ?? []).map((a) => [Number(a.id), a.name]))}
      rosters={(rosters ?? []).map((r) => ({ ...r, id: Number(r.id) }))}
    />
  );
}
