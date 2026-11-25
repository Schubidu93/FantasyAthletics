// Niederländisches Wörterbuch (web/sport/i18n-nl.js): Jeder deutsche Text der App (tests/i18n-extract.ts) braucht eine
// Übersetzung, und jeder Schlüssel muss in der App vorkommen (sonst ist er veraltet und die Stelle bliebe deutsch).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { germanTexts } from "./i18n-extract";

// @ts-expect-error – reines JavaScript der App
import { dictionary, translate } from "../web/i18n.js";
import "../web/sport/i18n-nl.js";   // meldet das niederländische Wörterbuch an

const WEB = join(import.meta.dirname, "..", "web");
// keine sichtbaren Texte (Code-Werte, Fehlertexte von Supabase, Zeitzone)
const NOT_TEXT = new Set(["Europe/Berlin", "Notification", "Escape", "Invalid login credentials", "Half Marathon", "full", "short"]);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("Niederländisch", () => {
  const found = germanTexts(WEB);
  const entries: [string, string | ((...a: string[]) => string)][] = dictionary("nl");
  const keys = new Set(entries.map(([k]) => k));

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
    const bad = entries.filter(([k, v]) => typeof v === "string"
      && (v.match(/\{(\d)\}/g) ?? []).some((m) => Number(m[1]) >= k.split("{}").length - 1)).map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("übersetzt Sätze, Teile und Muster", () => {
    const nl = (x: string) => translate(x, "nl");
    expect(nl("Stabhochsprung · Jg. 1994")).toBe("Polsstokhoogspringen · geb. 1994");   // „{} ab {}“ passt nicht mitten ins Wort
    // Zeilenumbruch neben eingesetztem Wert fehlt (htm): „A,in den …“
    expect(nl("Kommende Wettkämpfe mit Disziplinen dieser Liga (Lauf): international ab Gold Label, in Europa ab Kategorie A,"
      + "in den Niederlanden ab Kategorie E. Das Programm stammt von World Athletics, sobald der Veranstalter es eingetragen hat."))
      .toContain("in Europa vanaf categorie A, in Nederland vanaf categorie E.");
    expect(nl("Fünfkampf (Halle)")).toBe("Vijfkamp (indoor)");
    expect(nl("Halbfinale 2")).toBe("Halve finale 2");
    expect(nl(" · Vorlauf 2")).toBe(" · Serie 2");
    expect(nl("2026: 791,46 Punkte · Platz 1")).toBe("2026: 791,46 punten · Plaats 1");
    expect(nl("2 Meilen · Hochsprung · 3000 m Hindernis · Halbmarathon Gehen · Fünfkampf (Halle)"))
      .toBe("2 mijl · Hoogspringen · 3000 m steeple · Halve marathon snelwandelen · Vijfkamp (indoor)");   // Faktoren-Liste in den Regeln
    expect(["Siebenkampf U18 (Halle)", "Diskuswurf (1,5kg)", "60 m Hürden (91.4cm)", "Fünfkampf Girls (Halle)"].map(nl))
      .toEqual(["Zevenkamp U18 (indoor)", "Discuswerpen (1,5kg)", "60 m horden (91.4cm)", "Vijfkamp meisjes (indoor)"]);
    expect(["3000 m Hindernis", "4x400 m Staffel Mixed", "20 km Gehen", "2 Meilen (Halle)", "Halbmarathon Gehen"].map(nl))
      .toEqual(["3000 m steeple", "4x400 m estafette gemengd", "20 km snelwandelen", "2 mijl (indoor)", "Halve marathon snelwandelen"]);   // Textstück hinter einem eingesetzten Wert
    expect(nl("6.76 w (+2.5) · gültig 6.63")).toBe("6.76 w (+2.5) · geldig 6.63");
    expect(nl("Isabel VAN DEN BERG")).toBe("Isabel VAN DEN BERG");   // Namen bleiben, auch mit „ab“ darin
    expect(nl("in dieser Liga · Platz 3 von 104 auf der Position Mittelstrecke"))
      .toBe("in deze competitie · plaats 3 van 104 op de positie Middellange afstand");
    expect(nl("Mutig. Sehr mutig. Auf diesen Kader wettet niemand.")).toBe("Moedig. Heel moedig. Op deze selectie wedt niemand.");
  });

  it("Muster: Restzeit, Wochentag", () => {
    expect(translate("in 1 Tag", "nl")).toBe("over 1 dag");
    expect(translate("in 2 Tagen 16 Std.", "nl")).toBe("over 2 dagen 16 uur");
    expect(translate("in 3 Std. 5 Min.", "nl")).toBe("over 3 uur 5 min.");
    expect(translate("Fr., 27.11.26", "nl")).toBe("vr., 27.11.26");
  });
});
