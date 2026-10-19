"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { fmtDateTime, GROUPS } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Member, PoolAthlete, Season } from "@/lib/types";
import { useRpc } from "@/lib/use-rpc";

type Pick = { pick_no: number; member_id: number; athlete_id: number };
type State = { next_pick_no: number; total_picks: number; member_id: number | null; round: number; finished: boolean };

export function DraftBoard({
  season, members, meId, isAdmin, state, picks, pool,
}: {
  season: Season; members: Member[]; meId: number | null; isAdmin: boolean;
  state: State | null; picks: Pick[]; pool: PoolAthlete[];
}) {
  const router = useRouter();
  const { call, pending, error } = useRpc();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [gender, setGender] = useState("");
  const [view, setView] = useState<"pool" | "board">("pool");

  // Live-Updates: bei jedem neuen Pick die Seite neu laden.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`draft-${season.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "draft_picks", filter: `season_id=eq.${season.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "seasons", filter: `id=eq.${season.id}` }, () => router.refresh())
      .subscribe();
    const poll = setInterval(() => router.refresh(), 20000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [season.id, router]);

  const athleteById = useMemo(() => new Map(pool.map((a) => [a.id, a])), [pool]);
  const teamName = (id: number | null) => members.find((m) => m.id === id)?.team_name ?? "?";
  const taken = new Set(picks.map((p) => p.athlete_id));
  const available = pool.filter((a) => !taken.has(a.id) && !a.owner_member_id &&
    (!q || a.name.toLowerCase().includes(q.toLowerCase())) && (!group || a.event_group === group) && (!gender || a.gender === gender));

  const myTurn = season.status === "drafting" && state?.member_id === meId;
  const canPick = season.status === "drafting" && (myTurn || isAdmin);
  const ordered = [...members].sort((a, b) => (a.draft_position ?? 99) - (b.draft_position ?? 99));
  const rounds = season.roster_size;

  if (season.status === "setup") {
    return (
      <div className="card space-y-2">
        <h1 className="h1">Draft</h1>
        <p className="muted">
          Der Draft hat noch nicht begonnen{season.draft_starts_at ? ` – geplant für ${fmtDateTime(season.draft_starts_at)}` : ""}.
          Der Admin legt die Reihenfolge fest und startet ihn.
        </p>
        <ol className="list-decimal pl-5 text-sm">
          {ordered.map((m) => <li key={m.id}>{m.team_name}{m.draft_position ? "" : " (noch ohne Position)"}</li>)}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`card ${myTurn ? "border-green-500 bg-green-50 dark:bg-green-950" : ""}`}>
        {season.status === "drafting" && state ? (
          <>
            <div className="text-sm text-slate-500">Pick {state.next_pick_no} / {state.total_picks} · Runde {state.round}</div>
            <div className="text-lg font-semibold">{myTurn ? "Du bist am Zug! 🎯" : `Am Zug: ${teamName(state.member_id)}`}</div>
          </>
        ) : (
          <div className="text-lg font-semibold">Draft abgeschlossen ✓</div>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex gap-2">
        <button className={view === "pool" ? "btn" : "btn-secondary"} onClick={() => setView("pool")}>Verfügbar</button>
        <button className={view === "board" ? "btn" : "btn-secondary"} onClick={() => setView("board")}>Draftboard</button>
      </div>

      {view === "pool" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input className="input" placeholder="Suche…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">Alle Gruppen</option>
              {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Alle</option><option value="M">Männer</option><option value="W">Frauen</option>
            </select>
          </div>
          <div className="card p-0">
            <table className="table">
              <tbody>
                {available.slice(0, 300).map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="font-medium">{a.name}</div>
                      <div className="text-xs text-slate-500">{a.gender} · {a.best_discipline} {a.best_mark}</div>
                    </td>
                    <td>{a.event_group ?? "–"}</td>
                    <td className="text-right">{a.best_score}</td>
                    <td className="text-right">
                      {canPick && (
                        <button className="btn py-1" disabled={pending}
                          onClick={() => confirm(`${a.name} draften${!myTurn ? ` für ${teamName(state?.member_id ?? null)}` : ""}?`) &&
                            call("make_draft_pick", { p_season: season.id, p_athlete: a.id })}>
                          Draft
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>R</th>{ordered.map((m) => <th key={m.id} className="min-w-28">{m.team_name}</th>)}</tr>
            </thead>
            <tbody>
              {Array.from({ length: rounds }, (_, r) => (
                <tr key={r}>
                  <td className="text-slate-500">{r + 1}</td>
                  {ordered.map((m, i) => {
                    const n = ordered.length;
                    const pos = r % 2 === 0 ? i : n - 1 - i;
                    const pickNo = r * n + pos + 1;
                    const p = picks.find((x) => x.pick_no === pickNo);
                    const a = p ? athleteById.get(p.athlete_id) : undefined;
                    return (
                      <td key={m.id} className={pickNo === state?.next_pick_no && season.status === "drafting" ? "bg-green-100 dark:bg-green-900" : ""}>
                        {a ? <><div className="text-xs font-medium">{a.name}</div><div className="text-xs text-slate-500">{a.event_group}</div></>
                          : <span className="text-xs text-slate-400">#{pickNo}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
