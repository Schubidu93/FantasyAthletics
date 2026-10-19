import Link from "next/link";
import { redirect } from "next/navigation";
import { SeasonForms } from "@/components/SeasonForms";
import { STATUS_LABEL } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Season } from "@/lib/types";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase.from("season_members").select("season_id, team_name").eq("user_id", user.id);
  const ids = (memberships ?? []).map((m) => m.season_id);
  const { data: seasons } = ids.length
    ? await supabase.from("seasons").select("*").in("id", ids).order("year", { ascending: false }).returns<Season[]>()
    : { data: [] as Season[] };

  const active = (seasons ?? []).filter((s) => s.status !== "finished");
  if (active.length === 1) redirect(`/s/${active[0].id}`);

  return (
    <div className="space-y-6">
      <h1 className="h1">Deine Saisons</h1>
      {(seasons ?? []).length === 0 && <p className="muted">Du bist noch in keiner Saison. Tritt mit einem Einladungscode bei oder lege eine neue an.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {(seasons ?? []).map((s) => (
          <Link key={s.id} href={`/s/${s.id}`} className="card hover:border-brand-500">
            <div className="font-semibold">{s.name}</div>
            <div className="muted">
              {s.year} · {STATUS_LABEL[s.status]} · {memberships?.find((m) => m.season_id === s.id)?.team_name}
            </div>
          </Link>
        ))}
      </div>
      <SeasonForms />
    </div>
  );
}
