import Link from "next/link";
import { fmtDate, fmtDateTime, fmtPoints, slotLabel } from "@/lib/format";
import { getSeasonContext } from "@/lib/season";

export default async function StandingsPage({ params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  const { supabase, season, currentMatchday, matchdays, me } = await getSeasonContext(seasonId);
  const shownMatchday = currentMatchday ?? [...matchdays].reverse().find((m) => m.ends_on < new Date().toISOString().slice(0, 10)) ?? null;

  const [{ data: standings }, { data: mdStandings }, { data: recent }, { data: lastImport }] = await Promise.all([
    supabase.from("standings").select("member_id, team_name, points, scored_results").eq("season_id", season.id).order("points", { ascending: false }),
    shownMatchday
      ? supabase.from("matchday_standings").select("member_id, points").eq("matchday_id", shownMatchday.id)
      : Promise.resolve({ data: [] as { member_id: number; points: number }[] }),
    supabase.from("scored_results").select("member_id, slot, athlete_id, date, competition, discipline, place, mark, total_points")
      .eq("season_id", season.id).gt("total_points", 0).order("date", { ascending: false }).limit(20),
    supabase.from("import_runs").select("kind, finished_at, ok").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1),
  ]);

  const athleteIds = [...new Set((recent ?? []).map((r) => r.athlete_id))];
  const { data: athletes } = athleteIds.length
    ? await supabase.from("athletes").select("id, name").in("id", athleteIds)
    : { data: [] as { id: number; name: string }[] };
  const athleteName = new Map((athletes ?? []).map((a) => [a.id, a.name]));
  const mdPoints = new Map((mdStandings ?? []).map((m) => [m.member_id, m.points]));
  const teamName = new Map((standings ?? []).map((s) => [s.member_id, s.team_name]));

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="h2">Gesamtwertung {season.year}</h2>
        <table className="table">
          <thead>
            <tr>
              <th className="w-8">#</th><th>Team</th>
              {shownMatchday && <th className="text-right">ST {shownMatchday.number}</th>}
              <th className="text-right">Punkte</th>
            </tr>
          </thead>
          <tbody>
            {(standings ?? []).map((s, i) => (
              <tr key={s.member_id} className={s.member_id === me?.id ? "bg-brand-50 dark:bg-slate-800" : ""}>
                <td>{i + 1}</td>
                <td><Link className="hover:underline" href={`/s/${season.id}/teams/${s.member_id}`}>{s.team_name}</Link></td>
                {shownMatchday && <td className="text-right text-slate-500">{fmtPoints(mdPoints.get(s.member_id))}</td>}
                <td className="text-right font-semibold">{fmtPoints(s.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shownMatchday && (
          <p className="muted mt-2">
            Spieltag {shownMatchday.number}: {fmtDate(shownMatchday.starts_on)} – {fmtDate(shownMatchday.ends_on)}
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="h2">Letzte Punkte</h2>
        {(recent ?? []).length === 0 ? <p className="muted">Noch keine gewerteten Ergebnisse.</p> : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(recent ?? []).map((r, i) => (
              <li key={i} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/s/${season.id}/athletes/${r.athlete_id}`} className="font-medium hover:underline">
                    {athleteName.get(r.athlete_id)}
                  </Link>{" "}
                  <span className="text-slate-500">({teamName.get(r.member_id)}, {slotLabel(r.slot)})</span>
                  <div className="truncate text-xs text-slate-500">
                    {fmtDate(r.date)} · {r.discipline} · {r.place ? `${r.place}. ` : ""}{r.mark} · {r.competition}
                  </div>
                </div>
                <div className="font-semibold">+{fmtPoints(r.total_points)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="muted text-center text-xs">
        Letzter Import: {fmtDateTime(lastImport?.[0]?.finished_at)} {lastImport?.[0] && !lastImport[0].ok && "⚠️ fehlgeschlagen"}
      </p>
    </div>
  );
}
