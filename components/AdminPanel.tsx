"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Matchday, Member, Season } from "@/lib/types";
import { useRpc } from "@/lib/use-rpc";

type Run = { id: number; kind: string; started_at: string; finished_at: string | null; ok: boolean | null; message: string | null };

export function AdminPanel({ season, members, matchdays, runs }: { season: Season; members: Member[]; matchdays: Matchday[]; runs: Run[] }) {
  const router = useRouter();
  const { call, pending, error, setError } = useRpc();
  const [s, setS] = useState({
    name: season.name,
    pool_threshold: season.pool_threshold,
    perf_threshold: season.perf_threshold,
    perf_factor: season.perf_factor,
    placing_factor: season.placing_factor,
    cross_factor: season.cross_factor,
    roster_size: season.roster_size,
    lineup_slots: season.lineup_slots.join(", "),
    draft_starts_at: season.draft_starts_at ? season.draft_starts_at.slice(0, 16) : "",
  });
  const [order, setOrder] = useState(() =>
    [...members].sort((a, b) => (a.draft_position ?? 99) - (b.draft_position ?? 99)).map((m) => m.id));
  const [md, setMd] = useState({ first: `${season.year}-01-01`, last: `${season.year}-12-31`, days: 14 });
  const [saved, setSaved] = useState(false);
  const inSetup = season.status === "setup";

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    const { error } = await createClient().from("seasons").update({
      name: s.name,
      pool_threshold: Number(s.pool_threshold),
      perf_threshold: Number(s.perf_threshold),
      perf_factor: Number(s.perf_factor),
      placing_factor: Number(s.placing_factor),
      cross_factor: Number(s.cross_factor),
      roster_size: Number(s.roster_size),
      lineup_slots: s.lineup_slots.split(",").map((x) => x.trim()).filter(Boolean),
      draft_starts_at: s.draft_starts_at ? new Date(s.draft_starts_at).toISOString() : null,
    }).eq("id", season.id);
    if (error) setError(error.message);
    else {
      setSaved(true);
      router.refresh();
    }
  }

  async function setStatus(status: string) {
    const { error } = await createClient().from("seasons").update({ status }).eq("id", season.id);
    if (error) setError(error.message);
    else router.refresh();
  }

  const move = (i: number, d: number) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  const shuffle = () => setOrder([...order].sort(() => Math.random() - 0.5));
  const team = (id: number) => members.find((m) => m.id === id)?.team_name;
  const field = (key: keyof typeof s, label: string, type = "number", step?: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} step={step} value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="h1">Admin</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="card space-y-2">
        <h2 className="h2">Einladen</h2>
        <p className="text-sm">Einladungscode: <code className="badge text-base">{season.join_code}</code></p>
        <p className="muted">Mitspieler melden sich an und treten mit diesem Code bei (nur vor dem Draft).</p>
      </section>

      <form onSubmit={saveSettings} className="card space-y-3">
        <h2 className="h2">Regeln</h2>
        <div className="grid grid-cols-2 gap-3">
          {field("name", "Name", "text")}
          {field("pool_threshold", "Pool-Schwelle (WA-Punkte)")}
          {field("perf_threshold", "Leistungs-Schwelle")}
          {field("perf_factor", "Leistungs-Faktor", "number", "0.01")}
          {field("placing_factor", "Platzierungs-Faktor", "number", "0.01")}
          {field("cross_factor", "Cross-Faktor", "number", "0.01")}
          {field("roster_size", "Kadergröße")}
          {field("draft_starts_at", "Draft-Termin", "datetime-local")}
        </div>
        {field("lineup_slots", "Positionen (kommagetrennt, WC… = Wildcard)", "text")}
        <p className="muted text-xs">
          Punkte je Ergebnis = (max(0, WA-Punkte − Leistungs-Schwelle) × Leistungs-Faktor + Platzierungspunkte × Platzierungs-Faktor) × Disziplinfaktor.
          Cross: nur WA-Cross-Platzierungspunkte × Cross-Faktor × Disziplinfaktor.
        </p>
        <div className="flex items-center gap-3">
          <button className="btn">Speichern</button>
          {saved && <span className="text-sm text-green-600">Gespeichert ✓</span>}
        </div>
      </form>

      <section className="card space-y-3">
        <h2 className="h2">Spieltage ({matchdays.length})</h2>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="label">Von</label><input type="date" className="input" value={md.first} onChange={(e) => setMd({ ...md, first: e.target.value })} /></div>
          <div><label className="label">Bis</label><input type="date" className="input" value={md.last} onChange={(e) => setMd({ ...md, last: e.target.value })} /></div>
          <div><label className="label">Tage je Spieltag</label><input type="number" className="input" value={md.days} onChange={(e) => setMd({ ...md, days: Number(e.target.value) })} /></div>
        </div>
        <button className="btn-secondary" disabled={pending}
          onClick={() => confirm("Alle bestehenden Spieltage werden ersetzt. Fortfahren?") &&
            call("generate_matchdays", { p_season: season.id, p_first: md.first, p_last: md.last, p_days: md.days })}>
          Spieltage erzeugen
        </button>
        <p className="muted text-xs">Einzelne Spieltage lassen sich im Supabase Table Editor (Tabelle matchdays) anpassen.</p>
        <div className="flex flex-wrap gap-1 text-xs">
          {matchdays.map((m) => <span key={m.id} className="badge">{m.number}: {fmtDate(m.starts_on)}–{fmtDate(m.ends_on)}</span>)}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="h2">Draft</h2>
        <ol className="space-y-1">
          {order.map((id, i) => (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-slate-500">{i + 1}.</span>
              <span className="flex-1">{team(id)}</span>
              {inSetup && (
                <>
                  <button className="btn-secondary px-2 py-0.5" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="btn-secondary px-2 py-0.5" disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                </>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {inSetup && (
            <>
              <button className="btn-secondary" onClick={shuffle}>🎲 Auslosen</button>
              <button className="btn-secondary" disabled={pending} onClick={() => call("set_draft_order", { p_season: season.id, p_member_ids: order })}>
                Reihenfolge speichern
              </button>
              <button className="btn" disabled={pending}
                onClick={() => confirm("Draft jetzt starten? Teilnehmer und Reihenfolge sind danach fix.") && call("start_draft", { p_season: season.id })}>
                Draft starten
              </button>
            </>
          )}
          {season.status === "drafting" && (
            <>
              <button className="btn-secondary" disabled={pending}
                onClick={() => confirm("Letzten Pick zurücknehmen?") && call("undo_last_pick", { p_season: season.id })}>
                Letzten Pick zurücknehmen
              </button>
              <button className="btn-secondary" disabled={pending}
                onClick={() => confirm("Draft beenden? Fehlende Picks können danach als Free Agents geholt werden.") && call("finish_draft", { p_season: season.id })}>
                Draft beenden
              </button>
            </>
          )}
          {season.status === "active" && (
            <button className="btn-danger" onClick={() => confirm("Saison beenden? Danach sind keine Änderungen mehr möglich.") && setStatus("finished")}>
              Saison beenden
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="h2">Letzte Importe</h2>
        <ul className="space-y-1 text-sm">
          {runs.map((r) => (
            <li key={r.id}>
              {r.ok === null ? "⏳" : r.ok ? "✅" : "❌"} {r.kind} · {fmtDateTime(r.started_at)}
              {r.message && <div className="truncate text-xs text-slate-500" title={r.message}>{r.message.split("\n")[0]}</div>}
            </li>
          ))}
        </ul>
        <p className="muted mt-2 text-xs">Importe laufen täglich über GitHub Actions und können dort auch manuell gestartet werden.</p>
      </section>
    </div>
  );
}
