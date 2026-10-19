"use client";
import { useState } from "react";
import { fmtPoints, isWildcard, slotLabel } from "@/lib/format";
import type { Matchday } from "@/lib/types";
import { useRpc } from "@/lib/use-rpc";

type RosterAthlete = { id: number; name: string; event_group: string | null };

export function LineupEditor({
  seasonId, matchday, slots, roster, lineup, slotPoints, locked,
}: {
  seasonId: number;
  matchday: Matchday;
  slots: string[];
  roster: RosterAthlete[];
  lineup: Record<string, number>;
  slotPoints: Record<string, number>;
  locked: boolean;
}) {
  const { call, pending, error } = useRpc();
  const rosterIds = new Set(roster.map((a) => a.id));
  // Athleten, die nicht mehr im Kader sind, gelten als leer.
  const initial = Object.fromEntries(slots.map((s) => [s, rosterIds.has(lineup[s]) ? lineup[s] : null]));
  const [value, setValue] = useState<Record<string, number | null>>(initial);
  const [saved, setSaved] = useState(false);

  const isLocked = (slot: string) => locked && initial[slot] !== null;
  const used = new Set(Object.values(value).filter(Boolean));
  const dirty = slots.some((s) => value[s] !== initial[s]);

  async function save() {
    setSaved(false);
    const res = await call("set_lineup", { p_season: seasonId, p_matchday: matchday.number, p_lineup: value });
    if (res !== undefined) setSaved(true);
  }

  return (
    <div className="space-y-3">
      {locked && <p className="text-xs text-amber-600">Der Spieltag läuft – nur leere Positionen können noch besetzt werden.</p>}
      <div className="space-y-2">
        {slots.map((slot) => {
          const options = roster.filter((a) => isWildcard(slot) || a.event_group === slot);
          return (
            <div key={slot} className="flex items-center gap-2">
              <div className="w-24 shrink-0 text-sm text-slate-500">{slotLabel(slot)}</div>
              <select className="input" disabled={isLocked(slot)} value={value[slot] ?? ""}
                onChange={(e) => setValue({ ...value, [slot]: e.target.value ? Number(e.target.value) : null })}>
                <option value="">– leer –</option>
                {options.map((a) => (
                  <option key={a.id} value={a.id} disabled={used.has(a.id) && value[slot] !== a.id}>
                    {a.name}{isWildcard(slot) && a.event_group ? ` (${a.event_group})` : ""}
                  </option>
                ))}
              </select>
              <div className="w-14 shrink-0 text-right text-sm">{fmtPoints(slotPoints[slot])}</div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button className="btn" onClick={save} disabled={pending || !dirty}>Aufstellung speichern</button>
        {saved && !dirty && <span className="text-sm text-green-600">Gespeichert ✓</span>}
      </div>
      <p className="muted text-xs">Die Aufstellung gilt auch für alle folgenden Spieltage, bis du sie änderst.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
