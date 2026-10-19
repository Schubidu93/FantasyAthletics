import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy Athletics",
  description: "Fantasy-Leichtathletik mit deutschen Läuferinnen und Läufern",
  appleWebApp: { capable: true, title: "Fantasy Athletics", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#1f57d1",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <div className="mx-auto flex h-12 max-w-4xl items-center justify-between px-4">
            <Link href="/" className="font-bold text-brand-600">🏃 Fantasy Athletics</Link>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 pb-28 pt-4">{children}</main>
      </body>
    </html>
  );
}
