"use client";
import { useRpc } from "@/lib/use-rpc";

export function ReleaseButton({ seasonId, athleteId, name }: { seasonId: number; athleteId: number; name: string }) {
  const { call, pending, error } = useRpc();
  return (
    <>
      <button className="text-xs text-red-600 hover:underline disabled:opacity-50" disabled={pending}
        onClick={() => confirm(`${name} wirklich abgeben? Der Athlet wird sofort Free Agent.`) &&
          call("release_athlete", { p_season: seasonId, p_athlete: athleteId })}>
        Abgeben
      </button>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </>
  );
}
