"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRpc } from "@/lib/use-rpc";

export function SeasonForms() {
  const router = useRouter();
  const { call, pending, error } = useRpc();
  const [code, setCode] = useState("");
  const [team, setTeam] = useState("");
  const [name, setName] = useState(`Fantasy Athletics ${new Date().getFullYear()}`);
  const [year, setYear] = useState(new Date().getFullYear());

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const id = await call<number>("join_season", { p_code: code, p_team_name: team });
    if (id) router.push(`/s/${id}`);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const id = await call<number>("create_season", { p_year: year, p_name: name, p_team_name: team });
    if (id) router.push(`/s/${id}/admin`);
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="team">Dein Teamname</label>
        <input id="team" className="input" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="z. B. Spikes & Splits" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <form onSubmit={join} className="card space-y-3">
          <h2 className="h2">Saison beitreten</h2>
          <input className="input" placeholder="Einladungscode" value={code} onChange={(e) => setCode(e.target.value)} required />
          <button className="btn w-full" disabled={pending || !team}>Beitreten</button>
        </form>
        <form onSubmit={create} className="card space-y-3">
          <h2 className="h2">Neue Saison anlegen</h2>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} required />
          <button className="btn w-full" disabled={pending || !team}>Anlegen</button>
        </form>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
