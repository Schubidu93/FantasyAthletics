"use client";
import { useState } from "react";
import { fmtDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";
import { useRpc } from "@/lib/use-rpc";

type Trade = { id: number; proposer_id: number; receiver_id: number; status: string; message: string | null; created_at: string };
type Item = { trade_id: number; athlete_id: number; from_member_id: number };
type RosterRow = { id: number; name: string; event_group: string | null; member_id: number };

const STATUS: Record<string, string> = {
  pending: "offen", accepted: "angenommen", rejected: "abgelehnt", cancelled: "zurückgezogen", invalid: "ungültig",
};

export function TradeCenter({
  seasonId, active, meId, members, trades, items, athleteNames, rosters,
}: {
  seasonId: number; active: boolean; meId: number | null; members: Member[];
  trades: Trade[]; items: Item[]; athleteNames: Record<number, string>; rosters: RosterRow[];
}) {
  const { call, pending, error } = useRpc();
  const [partner, setPartner] = useState<number | "">("");
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>([]);
  const [message, setMessage] = useState("");
  const team = (id: number) => members.find((m) => m.id === id)?.team_name ?? "?";
  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function propose() {
    const res = await call("propose_trade", { p_season: seasonId, p_receiver: partner, p_give: give, p_get: get, p_message: message || null });
    if (res !== undefined) {
      setGive([]);
      setGet([]);
      setMessage("");
    }
  }

  const side = (t: Trade, member: number) =>
    items.filter((i) => i.trade_id === t.id && i.from_member_id === member).map((i) => athleteNames[i.athlete_id]).join(", ") || "nichts";

  return (
    <div className="space-y-6">
      <h1 className="h1">Trades</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {active && meId && (
        <section className="card space-y-3">
          <h2 className="h2">Neues Angebot</h2>
          <select className="input" value={partner} onChange={(e) => { setPartner(e.target.value ? Number(e.target.value) : ""); setGet([]); }}>
            <option value="">Mit wem?</option>
            {members.filter((m) => m.id !== meId).map((m) => <option key={m.id} value={m.id}>{m.team_name}</option>)}
          </select>
          {partner && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="label">Du gibst</div>
                {rosters.filter((r) => r.member_id === meId).map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={give.includes(r.id)} onChange={() => toggle(give, setGive, r.id)} />
                    {r.name} <span className="text-xs text-slate-500">{r.event_group}</span>
                  </label>
                ))}
              </div>
              <div>
                <div className="label">Du bekommst</div>
                {rosters.filter((r) => r.member_id === partner).map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={get.includes(r.id)} onChange={() => toggle(get, setGet, r.id)} />
                    {r.name} <span className="text-xs text-slate-500">{r.event_group}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <input className="input" placeholder="Nachricht (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="btn" disabled={pending || !partner || give.length + get.length === 0} onClick={propose}>Angebot senden</button>
        </section>
      )}

      <section className="space-y-2">
        {trades.length === 0 && <p className="muted">Noch keine Trades.</p>}
        {trades.map((t) => (
          <div key={t.id} className="card space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-medium">{team(t.proposer_id)} → {team(t.receiver_id)}</span>
              <span className="badge">{STATUS[t.status]}</span>
            </div>
            <div>{team(t.proposer_id)} gibt: <b>{side(t, t.proposer_id)}</b></div>
            <div>{team(t.receiver_id)} gibt: <b>{side(t, t.receiver_id)}</b></div>
            {t.message && <div className="italic text-slate-500">„{t.message}“</div>}
            <div className="text-xs text-slate-500">{fmtDateTime(t.created_at)}</div>
            {t.status === "pending" && t.receiver_id === meId && (
              <div className="flex gap-2 pt-1">
                <button className="btn" disabled={pending} onClick={() => call("respond_trade", { p_trade: t.id, p_accept: true })}>Annehmen</button>
                <button className="btn-secondary" disabled={pending} onClick={() => call("respond_trade", { p_trade: t.id, p_accept: false })}>Ablehnen</button>
              </div>
            )}
            {t.status === "pending" && t.proposer_id === meId && (
              <button className="btn-secondary" disabled={pending} onClick={() => call("respond_trade", { p_trade: t.id, p_accept: false })}>Zurückziehen</button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
