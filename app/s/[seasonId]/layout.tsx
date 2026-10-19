import { SeasonNav } from "@/components/SeasonNav";
import { STATUS_LABEL } from "@/lib/format";
import { getSeasonContext } from "@/lib/season";

export default async function SeasonLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  const { season, me, isAdmin } = await getSeasonContext(seasonId);
  const base = `/s/${season.id}`;
  const items = [
    { href: base, label: "Tabelle", icon: "🏆" },
    ...(me ? [{ href: `${base}/teams/${me.id}`, label: "Mein Team", icon: "👟" }] : []),
    { href: `${base}/athletes`, label: "Athleten", icon: "📋" },
    season.status === "setup" || season.status === "drafting"
      ? { href: `${base}/draft`, label: "Draft", icon: "🎯" }
      : { href: `${base}/trades`, label: "Trades", icon: "🔁" },
    ...(isAdmin ? [{ href: `${base}/admin`, label: "Admin", icon: "⚙️" }] : []),
  ];
  return (
    <>
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <div className="font-semibold">{season.name}</div>
        <span className="badge">{STATUS_LABEL[season.status]}</span>
      </div>
      {children}
      <SeasonNav items={items} />
    </>
  );
}
