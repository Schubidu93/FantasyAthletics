// Niederländisches Wörterbuch (web/sport/i18n-nl.js): Jeder deutsche Text der App (tests/i18n-extract.ts) braucht eine
// Übersetzung, und jeder Schlüssel muss in der App vorkommen (sonst ist er veraltet und die Stelle bliebe deutsch).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { germanTexts } from "./i18n-extract";

type Pattern = [RegExp, string | ((...a: string[]) => string)];
const { texts, patterns } = vi.hoisted(() => ({ texts: {} as Record<string, string>, patterns: [] as Pattern[] }));
vi.mock("../web/lib.js", () => ({ registerTexts: (_l: string, t: Record<string, string>, p: Pattern[] = []) => {
  Object.assign(texts, t); patterns.push(...p);
} }));
const viaPattern = (s: string) => { for (const [re, rep] of patterns) if (re.test(s)) return s.replace(re, rep as string); return s; };

import "../web/sport/i18n-nl.js";   // meldet sein Wörterbuch über das (nachgebildete) registerTexts an

const WEB = join(import.meta.dirname, "..", "web");
// keine sichtbaren Texte (Code-Werte, Fehlertexte von Supabase, Zeitzone)
const NOT_TEXT = new Set(["Europe/Berlin", "Notification", "Escape", "Invalid login credentials", "Half Marathon", "full", "short"]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Niederländisch", () => {
  const found = germanTexts(WEB);
  const keys = new Set(Object.keys(texts).map(squash));

  it("jeder deutsche Text der App hat eine Übersetzung", () => {
    const missing = [...found.keys()].filter((t) => !keys.has(t) && !NOT_TEXT.has(t)).map((t) => `${t}   (${found.get(t)!.join(", ")})`);
    expect(missing).toEqual([]);
  });

  it("jeder Schlüssel kommt in der App vor", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "vendor" ? [] : files(join(dir, e.name))) : e.name.endsWith(".js") && !e.name.startsWith("i18n-") ? [join(dir, e.name)] : []);
    const source = squash(files(WEB).map((f) => readFileSync(f, "utf8")).join("\n"));
    // Schlüssel ohne {} stehen wörtlich im Code; mit {} zählen die Stücke dazwischen
    const stale = [...keys].filter((k) => !found.has(k) && !k.split("{}").every((p) => source.includes(p.trim())));
    expect(stale).toEqual([]);
  });

  it("Platzhalter der Übersetzung passen zum Schlüssel", () => {
    const bad = Object.entries(texts).filter(([k, v]) => {
      const n = squash(k).split("{}").length - 1;
      return (v.match(/\{(\d)\}/g) ?? []).some((m) => Number(m[1]) >= n);
    }).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("Muster: Restzeit, Wochentag", () => {
    expect(viaPattern("in 1 Tag")).toBe("over 1 dag");
    expect(viaPattern("in 2 Tagen 16 Std.")).toBe("over 2 dagen 16 uur");
    expect(viaPattern("in 3 Std. 5 Min.")).toBe("over 3 uur 5 min.");
    expect(viaPattern("Fr., 27.11.26")).toBe("vr., 27.11.26");
  });
});
