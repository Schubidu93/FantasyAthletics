"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtDate, fmtPoints, GROUPS } from "@/lib/format";
import type { PoolAthlete } from "@/lib/types";
import { useRpc } from "@/lib/use-rpc";

export function AthleteTable({
  seasonId, athletes, canClaim, myRoster, rosterFull,
}: {
  seasonId: number;
  athletes: PoolAthlete[];
  canClaim: boolean;
  myRoster: { id: number; name: string }[];
  rosterFull: boolean;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [gender, setGender] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);
  const [claiming, setClaiming] = useState<PoolAthlete | null>(null);
  const [drop, setDrop] = useState<number | "">("");
  const { call, pending, error } = useRpc();

  const list = useMemo(() => athletes.filter((a) =>
    (!q || a.name.toLowerCase().includes(q.toLowerCase())) &&
    (!group || a.event_group === group) &&
    (!gender || a.gender === gender) &&
    (!onlyFree || !a.owner_member_id)), [athletes, q, group, gender, onlyFree]);

  async function claim() {
    if (!claiming) return;
    const ok = await call("claim_free_agent", { p_season: seasonId, p_add: claiming.id, p_drop: drop || null });
    if (ok !== undefined) {
      setClaiming(null);
      setDrop("");
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input className="input col-span-2 sm:col-span-1" placeholder="Suche…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">Alle Gruppen</option>
          {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Alle</option><option value="M">Männer</option><option value="W">Frauen</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> nur frei
        </label>
      </div>

      {claiming && (
        <div className="card space-y-2 border-brand-500">
          <div className="font-medium">{claiming.name} holen</div>
          <select className="input" value={drop} onChange={(e) => setDrop(e.target.value ? Number(e.target.value) : "")}>
            <option value="">{rosterFull ? "Wen gibst du dafür ab?" : "Niemanden abgeben"}</option>
            {myRoster.map((a) => <option key={a.id} value={a.id}>{a.name} abgeben</option>)}
          </select>
          <div className="flex gap-2">
            <button className="btn" disabled={pending || (rosterFull && !drop)} onClick={claim}>Bestätigen</button>
            <button className="btn-secondary" onClick={() => setClaiming(null)}>Abbrechen</button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th>Athlet</th><th>Gruppe</th><th className="text-right">Bestl.</th><th className="text-right">Punkte</th><th>Team</th></tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link href={`/s/${seasonId}/athletes/${a.id}`} className="font-medium hover:underline">{a.name}</Link>
                  <div className="text-xs text-slate-500">
                    {a.gender === "W" ? "W" : "M"}{a.birth_year ? ` · ${a.birth_year}` : ""} · {a.best_discipline} {a.best_mark}
                    {a.last_result && ` · zuletzt ${fmtDate(a.last_result)}`}
                  </div>
                </td>
                <td>{a.event_group ?? "–"}</td>
                <td className="text-right">{a.best_score ?? "–"}</td>
                <td className="text-right font-semibold">{fmtPoints(a.season_points)}</td>
                <td>
                  {a.owner_team ? <span className="text-xs">{a.owner_team}</span>
                    : canClaim ? <button className="text-xs text-brand-600 hover:underline" onClick={() => setClaiming(a)}>Holen</button>
                      : <span className="text-xs text-slate-400">frei</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="muted p-4">Keine Athleten gefunden.</p>}
      </div>
    </div>
  );
}
