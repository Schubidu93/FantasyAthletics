import { AthleteTable } from "@/components/AthleteTable";
import { getSeasonContext } from "@/lib/season";
import type { PoolAthlete } from "@/lib/types";

export default async function AthletesPage({ params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  const { supabase, season, me } = await getSeasonContext(seasonId);
  const { data: pool } = await supabase.from("pool_overview").select("*").eq("season_id", season.id)
    .order("season_points", { ascending: false }).order("best_score", { ascending: false }).limit(2000).returns<PoolAthlete[]>();
  const myRoster = (pool ?? []).filter((a) => me && a.owner_member_id === me.id).map((a) => ({ id: Number(a.id), name: a.name }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="h1">Athletenpool</h1>
        <p className="muted">
          Deutsche Läuferinnen und Läufer mit mindestens {season.pool_threshold} WA-Punkten in der Topliste {season.year - 1} oder {season.year}.
        </p>
      </div>
      <AthleteTable
        seasonId={season.id}
        athletes={pool ?? []}
        canClaim={season.status === "active" && !!me}
        myRoster={myRoster}
        rosterFull={myRoster.length >= season.roster_size}
      />
    </div>
  );
}
