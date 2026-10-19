import { notFound } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { getSeasonContext } from "@/lib/season";

export default async function AdminPage({ params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  const { supabase, season, members, matchdays, isAdmin } = await getSeasonContext(seasonId);
  if (!isAdmin) notFound();
  const { data: runs } = await supabase.from("import_runs").select("*").order("started_at", { ascending: false }).limit(6);
  return <AdminPanel season={season} members={members} matchdays={matchdays} runs={runs ?? []} />;
}
