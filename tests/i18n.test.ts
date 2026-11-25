// Niederländisches Wörterbuch (web/sport/i18n-nl.js): Jeder Schlüssel muss als Textstück in der App vorkommen – sonst ist er
// veraltet (Text geändert) und die Stelle bliebe deutsch.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

type Pattern = [RegExp, string | ((...a: string[]) => string)];
const { texts, patterns } = vi.hoisted(() => ({ texts: {} as Record<string, string>, patterns: [] as Pattern[] }));
vi.mock("../web/lib.js", () => ({ registerTexts: (_l: string, t: Record<string, string>, p: Pattern[] = []) => {
  Object.assign(texts, t); patterns.push(...p);
} }));
const viaPattern = (s: string) => { for (const [re, rep] of patterns) if (re.test(s)) return s.replace(re, rep as string); return s; };

import "../web/sport/i18n-nl.js";   // meldet sein Wörterbuch über das (nachgebildete) registerTexts an

const WEB = join(import.meta.dirname, "..", "web");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "vendor" ? [] : files(join(dir, e.name))) : e.name.endsWith(".js") && e.name !== "i18n-nl.js" ? [join(dir, e.name)] : []);
const source = files(WEB).map((f) => readFileSync(f, "utf8")).join("\n").replace(/\s+/g, " ");

describe("Niederländisch", () => {
  it("alle Schlüssel kommen in der App vor", () => {
    const keys = Object.keys(texts);
    expect(keys.length).toBeGreaterThan(200);
    expect(keys.filter((k) => !source.includes(k))).toEqual([]);
    expect(Object.values(texts).every((v) => typeof v === "string" && v.trim())).toBe(true);
  });

  it("Muster: Restzeit, Wochentag, Jahrgang", () => {
    expect(viaPattern("in 1 Tag")).toBe("over 1 dag");
    expect(viaPattern("in 2 Tagen 16 Std.")).toBe("over 2 dagen 16 uur");
    expect(viaPattern("in 3 Std. 5 Min.")).toBe("over 3 uur 5 min.");
    expect(viaPattern("Fr., 27.11.26")).toBe("vr., 27.11.26");
    expect(viaPattern("1500 m · Jg. 1994")).toBe("1500 m · geb. 1994");
  });
});
