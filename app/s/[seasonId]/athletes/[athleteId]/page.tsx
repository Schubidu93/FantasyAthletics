import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDate, fmtPoints } from "@/lib/format";
import { getSeasonContext } from "@/lib/season";
import type { PoolAthlete, ResultPoints } from "@/lib/types";

export default async function AthletePage({ params }: { params: Promise<{ seasonId: string; athleteId: string }> }) {
  const { seasonId, athleteId } = await params;
  const { supabase, season } = await getSeasonContext(seasonId);
  const id = Number(athleteId);

  const [{ data: athlete }, { data: results }, { data: toplists }] = await Promise.all([
    supabase.from("pool_overview").select("*").eq("season_id", season.id).eq("id", id).maybeSingle<PoolAthlete>(),
    supabase.from("result_points").select("*").eq("season_id", season.id).eq("athlete_id", id)
      .order("date", { ascending: false }).returns<ResultPoints[]>(),
    supabase.from("toplist_entries").select("year, discipline, mark, score").eq("athlete_id", id).order("score", { ascending: false }),
  ]);
  if (!athlete) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{athlete.name}</h1>
        <p className="muted">
          {athlete.gender === "W" ? "Frauen" : "Männer"} · Jg. {athlete.birth_year ?? "?"} · Gruppe {athlete.event_group ?? "–"} ·{" "}
          {athlete.owner_team
            ? <Link className="hover:underline" href={`/s/${season.id}/teams/${athlete.owner_member_id}`}>{athlete.owner_team}</Link>
            : "Free Agent"}
          {" · "}
          <a className="hover:underline" href={`https://worldathletics.org/athletes/athlete=${athlete.id}`} target="_blank" rel="noreferrer">
            World Athletics ↗
          </a>
        </p>
        <p className="mt-1 text-lg font-semibold">{fmtPoints(athlete.season_points)} Punkte {season.year}</p>
      </div>

      <section className="card overflow-x-auto p-0">
        <h2 className="h2 px-4 pt-4">Ergebnisse {season.year}</h2>
        <table className="table">
          <thead>
            <tr><th>Datum</th><th>Wettkampf</th><th>Platz</th><th className="text-right">WA</th><th className="text-right">Leist.</th><th className="text-right">Platz.</th><th className="text-right">Σ</th></tr>
          </thead>
          <tbody>
            {(results ?? []).map((r) => (
              <tr key={r.result_id}>
                <td className="whitespace-nowrap">{fmtDate(r.date)}</td>
                <td>
                  <div>{r.discipline} · {r.mark}</div>
                  <div className="text-xs text-slate-500">{r.competition} · {r.category ?? "–"}{r.race && r.race !== "F" ? ` · ${r.race}` : ""}</div>
                </td>
                <td>
                  {r.place ?? "–"}
                  {r.wa_race && r.wa_race !== r.race && (
                    <div className="text-xs text-slate-500" title="Kombinierte Platzierung über alle Finalläufe">
                      {r.wa_race}: {r.wa_place ?? "–"}
                    </div>
                  )}
                  {r.placing_round && r.placing_round !== "F" && (
                    <div className="text-xs text-slate-500" title="Wertung der letzten Runde vor dem Finale">
                      {r.placing_place === 0 ? "Q/q" : `Runde: ${r.placing_place}.`}
                    </div>
                  )}
                </td>
                <td className="text-right">{r.result_score ?? "–"}</td>
                <td className="text-right">{fmtPoints(r.performance_points)}</td>
                <td className="text-right">{fmtPoints(r.placing_points)}</td>
                <td className="text-right font-semibold">{fmtPoints(r.total_points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(results ?? []).length === 0 && <p className="muted p-4">Noch keine Ergebnisse in {season.year}.</p>}
      </section>

      <section className="card">
        <h2 className="h2">Toplisten (DE)</h2>
        <ul className="text-sm">
          {(toplists ?? []).map((t) => (
            <li key={`${t.year}-${t.discipline}`}>{t.year} · {t.discipline}: {t.mark} ({t.score})</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
