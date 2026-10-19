import Link from "next/link";
import { notFound } from "next/navigation";
import { LineupEditor } from "@/components/LineupEditor";
import { ReleaseButton } from "@/components/ReleaseButton";
import { berlinToday, fmtDate, fmtPoints, slotLabel } from "@/lib/format";
import { getSeasonContext } from "@/lib/season";
import type { PoolAthlete } from "@/lib/types";

export default async function TeamPage({
  params, searchParams,
}: { params: Promise<{ seasonId: string; memberId: string }>; searchParams: Promise<{ md?: string }> }) {
  const { seasonId, memberId } = await params;
  const { md } = await searchParams;
  const { supabase, season, members, matchdays, currentMatchday, nextMatchday, me } = await getSeasonContext(seasonId);
  const member = members.find((m) => m.id === Number(memberId));
  if (!member) notFound();
  const isMe = member.id === me?.id;

  const matchday = matchdays.find((m) => m.number === Number(md))
    ?? currentMatchday ?? nextMatchday ?? matchdays[matchdays.length - 1] ?? null;

  const [{ data: roster }, { data: lineup }, { data: scored }, { data: mdTotals }] = await Promise.all([
    supabase.from("pool_overview").select("*").eq("season_id", season.id).eq("owner_member_id", member.id)
      .order("season_points", { ascending: false }).returns<PoolAthlete[]>(),
    matchday
      ? supabase.from("effective_lineups").select("slot, athlete_id").eq("member_id", member.id).eq("matchday", matchday.number)
      : Promise.resolve({ data: [] as { slot: string; athlete_id: number }[] }),
    matchday
      ? supabase.from("scored_results").select("slot, total_points").eq("member_id", member.id).eq("matchday_id", matchday.id)
      : Promise.resolve({ data: [] as { slot: string; total_points: number }[] }),
    supabase.from("matchday_standings").select("matchday, points").eq("member_id", member.id).order("matchday"),
  ]);

  const lineupMap = Object.fromEntries((lineup ?? []).map((l) => [l.slot, Number(l.athlete_id)]));
  const slotPoints = new Map<string, number>();
  (scored ?? []).forEach((s) => slotPoints.set(s.slot, (slotPoints.get(s.slot) ?? 0) + Number(s.total_points)));
  const today = berlinToday();
  const rosterById = new Map((roster ?? []).map((a) => [Number(a.id), a]));
  const editable = isMe && !!matchday && matchday.ends_on >= today && ["drafting", "active"].includes(season.status);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{member.team_name}</h1>
        <p className="muted">{(roster ?? []).length} / {season.roster_size} Athleten</p>
      </div>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2 mb-0">Aufstellung</h2>
          {matchdays.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {matchdays.map((m) => (
                <Link key={m.id} href={`?md=${m.number}`}
                  className={`rounded px-2 py-0.5 text-xs ${m.id === matchday?.id ? "bg-brand-600 text-white" : "bg-slate-100 dark:bg-slate-800"}`}>
                  {m.number}
                </Link>
              ))}
            </div>
          )}
        </div>
        {!matchday ? (
          <p className="muted">Es sind noch keine Spieltage angelegt.</p>
        ) : (
          <>
            <p className="muted">
              Spieltag {matchday.number}: {fmtDate(matchday.starts_on)} – {fmtDate(matchday.ends_on)}
              {matchday.starts_on <= today && matchday.ends_on >= today && " · läuft"}
            </p>
            {editable ? (
              <LineupEditor
                seasonId={season.id}
                matchday={matchday}
                slots={season.lineup_slots}
                roster={(roster ?? []).map((a) => ({ id: Number(a.id), name: a.name, event_group: a.event_group }))}
                lineup={lineupMap}
                slotPoints={Object.fromEntries(slotPoints)}
                locked={matchday.starts_on <= today}
              />
            ) : (
              <table className="table">
                <tbody>
                  {season.lineup_slots.map((slot) => {
                    const a = lineupMap[slot] ? rosterById.get(lineupMap[slot]) : undefined;
                    return (
                      <tr key={slot}>
                        <td className="w-28 text-slate-500">{slotLabel(slot)}</td>
                        <td>{a ? <Link className="hover:underline" href={`/s/${season.id}/athletes/${a.id}`}>{a.name}</Link> : lineupMap[slot] ? "(abgegeben)" : "–"}</td>
                        <td className="text-right">{fmtPoints(slotPoints.get(slot))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2 className="h2">Kader</h2>
        <table className="table">
          <thead><tr><th>Athlet</th><th>Gruppe</th><th className="text-right">Punkte</th>{isMe && season.status === "active" && <th />}</tr></thead>
          <tbody>
            {(roster ?? []).map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="hover:underline" href={`/s/${season.id}/athletes/${a.id}`}>{a.name}</Link>
                  <div className="text-xs text-slate-500">{a.best_discipline} {a.best_mark} ({a.best_score})</div>
                </td>
                <td>{a.event_group ?? "–"}</td>
                <td className="text-right">{fmtPoints(a.season_points)}</td>
                {isMe && season.status === "active" && (
                  <td className="text-right"><ReleaseButton seasonId={season.id} athleteId={Number(a.id)} name={a.name} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted mt-2 text-xs">Punkte = alle Saisonergebnisse des Athleten, unabhängig von Aufstellung und Team.</p>
      </section>

      {(mdTotals ?? []).length > 0 && (
        <section className="card">
          <h2 className="h2">Punkte je Spieltag</h2>
          <div className="flex flex-wrap gap-2">
            {(mdTotals ?? []).map((m) => (
              <div key={m.matchday} className="rounded-lg bg-slate-100 px-2 py-1 text-center text-xs dark:bg-slate-800">
                <div className="text-slate-500">ST {m.matchday}</div>
                <div className="font-semibold">{fmtPoints(m.points)}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
