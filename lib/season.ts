import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import { berlinToday } from "./format";
import type { Matchday, Member, Season } from "./types";

/** Lädt alles, was fast jede Saisonseite braucht. Pro Request gecacht. */
export const getSeasonContext = cache(async (seasonIdParam: string) => {
  const seasonId = Number(seasonIdParam);
  if (!Number.isInteger(seasonId)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: season }, { data: members }, { data: matchdays }, { data: profile }] = await Promise.all([
    supabase.from("seasons").select("*").eq("id", seasonId).maybeSingle<Season>(),
    supabase.from("season_members").select("*").eq("season_id", seasonId).order("draft_position").returns<Member[]>(),
    supabase.from("matchdays").select("*").eq("season_id", seasonId).order("number").returns<Matchday[]>(),
    supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (!season) notFound();

  const today = berlinToday();
  const mds = matchdays ?? [];
  const current = mds.find((m) => m.starts_on <= today && today <= m.ends_on) ?? null;
  const next = mds.find((m) => m.starts_on > today) ?? null;
  const me = (members ?? []).find((m) => m.user_id === user.id) ?? null;

  return {
    supabase,
    user,
    season,
    members: members ?? [],
    matchdays: mds,
    currentMatchday: current,
    nextMatchday: next,
    me,
    isAdmin: season.created_by === user.id || !!profile?.is_admin,
  };
});
