"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: string };

export function SeasonNav({ items }: { items: Item[] }) {
  const path = usePathname();
  const active = (href: string) =>
    items.filter((i) => path === i.href || path.startsWith(i.href + "/")).sort((a, b) => b.href.length - a.href.length)[0]?.href === href;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-4xl justify-around">
        {items.map((i) => (
          <Link key={i.href} href={i.href}
            className={`flex flex-1 flex-col items-center py-2 text-xs ${active(i.href) ? "font-semibold text-brand-600" : "text-slate-500"}`}>
            <span className="text-lg leading-none">{i.icon}</span>
            {i.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
