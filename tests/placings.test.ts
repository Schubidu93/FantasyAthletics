import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  combinedPlace, extractRacesFromHtml, extractRacesFromJson, isFinalRaceName, isPrelimRace, isSplitFinal,
  parseMark, prelimPlacing, type Race, type RaceEntry,
} from "../importer/placings";

const entry = (mark: string, name = "x", extra: Partial<RaceEntry> = {}): RaceEntry =>
  ({ athleteId: null, name, mark, place: null, qualified: false, ...extra });
const race = (name: string, entries: RaceEntry[], date: string | null = null): Race => ({ name, number: null, date, entries });

/** Echte GraphQL-Antworten der WM Tokio 2025 (gekürzt), wie sie fetchEventRaces verarbeitet. */
function waEvent(key: string) {
  const body = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `wa-event-${key}.json`), "utf8"));
  const events = body.data.getCalendarCompetitionResults.eventTitles.flatMap((t: { events: unknown[] }) => t.events);
  return extractRacesFromJson(events);
}

describe("Hilfsfunktionen", () => {
  it("parst Zeiten", () => {
    expect(parseMark("46.12")).toBe(46.12);
    expect(parseMark("1:46.60")).toBeCloseTo(106.6);
    expect(parseMark("13:45.23")).toBeCloseTo(825.23);
    expect(parseMark("2:10:33")).toBe(7833);
    expect(parseMark("13:45.23 PB")).toBeCloseTo(825.23);
    expect(parseMark("DNF")).toBeNull();
  });

  it("erkennt Läufe", () => {
    expect(isSplitFinal("F1")).toBe(true);
    expect(isSplitFinal("F")).toBe(false);
    expect(["H1", "SF2", "QF3", "SF"].every(isPrelimRace)).toBe(true);
    expect(["F", "F1"].some(isPrelimRace)).toBe(false);
    expect(["Final 1", "Final A", "F2", "Final"].every(isFinalRaceName)).toBe(true);
    expect(["Semifinal - Heat", "Round 1 - Heat"].some(isFinalRaceName)).toBe(false);
  });
});

describe("geteilte Finals", () => {
  it("Beispiel: Platz 5 in F1, zwei Schnellere in F2 -> Platz 7", () => {
    const races = [
      race("Heat 1", [entry("13:20.00")]),
      race("Final 1", ["13:40.00", "13:41.00", "13:42.00", "13:43.00", "13:44.00", "13:50.00", "DNF"].map((m) => entry(m))),
      race("Final 2", ["13:38.00", "13:43.50", "13:46.00", "14:10.00"].map((m) => entry(m))),
    ];
    expect(combinedPlace(races, "13:44.00")).toBe(7);
    expect(combinedPlace([...races, race("Final 3", [entry("13:44.00")])], "13:44.00")).toBe(7); // gleiche Zeit
  });

  it("findet den Athleten über ID oder Namen", () => {
    const races = [
      race("Final 1", [entry("3:40.00", "Hannes BURGER", { athleteId: 14000001 }), entry("3:41.00")]),
      race("Final 2", [entry("3:39.00"), entry("3:39.50")]),
    ];
    expect(combinedPlace(races, "3:40.01", { name: "hannes  burger" })).toBe(3);
    expect(combinedPlace(races, "3:40.01", { id: 14000001 })).toBe(3);
    expect(combinedPlace(races, "3:40.01")).toBeNull();
  });

  it("nur ein Finallauf gelistet: Platz daraus", () => {
    expect(combinedPlace([race("Final", [entry("1:00.00", "A", { place: 4 })])], null, { name: "A" })).toBe(4);
  });
});

describe("letzte Runde vor dem Finale (echte Daten WM Tokio 2025)", () => {
  const m800 = waEvent("7190593-10229501");   // Vorlauf, Halbfinale, Finale mit 8
  const m1500 = waEvent("7190593-10229502");  // Vorlauf, Halbfinale, Finale mit 14
  const w5000 = waEvent("7190593-10229514");  // Vorlauf, Finale mit 16

  it("liest Q/q aus dem qualified-Feld", () => {
    const sf = m800.filter((r) => r.name.startsWith("Semifinal")).flatMap((r) => r.entries);
    expect(sf.filter((e) => e.qualified)).toHaveLength(8);
  });

  it("800 m: Qualifizierte -> Q/q-Wert, Ausgeschiedene -> Gesamtplatz nach Zeit ab 9", () => {
    expect(prelimPlacing(m800, { name: "Marco AROP" })).toEqual({ round: "P9", place: 0 });       // Q
    expect(prelimPlacing(m800, { name: "Navasky ANDERSON" })).toEqual({ round: "P9", place: 0 }); // q
    expect(prelimPlacing(m800, { name: "Donavan BRAZIER" })).toEqual({ round: "P9", place: 9 });  // schnellster Ausgeschiedener
    expect(prelimPlacing(m800, { name: "Mark ENGLISH" })).toEqual({ round: "P9", place: 18 });   // 3. im HF 1, aber langsam
  });

  it("Vorlauf vor einem Halbfinale zählt nicht", () => {
    const heatOnly = m800.filter((r) => r.name.startsWith("Round 1")).flatMap((r) => r.entries)
      .find((e) => !m800.filter((r) => r.name.startsWith("Semifinal")).flatMap((r) => r.entries).some((s) => s.name === e.name))!;
    expect(prelimPlacing(m800, { name: heatOnly.name })).toBeNull();
  });

  it("1500 m mit 14 Finalisten -> Tabelle für Finals ab 10 Athleten", () => {
    const sf = m1500.filter((r) => r.name.startsWith("Semifinal")).flatMap((r) => r.entries);
    const q = sf.find((e) => e.qualified)!;
    const out = sf.filter((e) => !e.qualified && parseMark(e.mark) !== null)
      .sort((a, b) => parseMark(a.mark)! - parseMark(b.mark)!)[0];
    expect(prelimPlacing(m1500, { name: q.name })).toEqual({ round: "P10", place: 0 });
    expect(prelimPlacing(m1500, { name: out.name })).toEqual({ round: "P10", place: 15 });
  });

  it("5000 m ohne Halbfinale: Vorlauf ist die Runde vor dem Finale", () => {
    const heats = w5000.filter((r) => r.name.startsWith("Round 1")).flatMap((r) => r.entries);
    expect(prelimPlacing(w5000, { name: heats.find((e) => e.qualified)!.name })).toEqual({ round: "P10", place: 0 });
    const out = heats.filter((e) => !e.qualified && parseMark(e.mark) !== null)
      .sort((a, b) => parseMark(a.mark)! - parseMark(b.mark)!)[0];
    expect(prelimPlacing(w5000, { name: out.name })).toEqual({ round: "P10", place: 17 });
  });
});

describe("Extraktion", () => {
  it("liest Rennen aus API-JSON inkl. WA-ID aus urlSlug", () => {
    const races = extractRacesFromJson({
      eventId: 10229609,
      races: [
        { race: "Final", raceNumber: 1, date: "2026-07-01", results: [{ competitor: { id: "abc123", name: "A", urlSlug: "germany/a-14650473" }, mark: "13:40.00", place: "1.", qualified: null }] },
        { race: "Final", raceNumber: 2, date: "2026-07-01", results: [{ competitor: { id: "xyz", name: "B" }, mark: "13:30.00", place: "1.", qualified: null }] },
      ],
    });
    expect(races[0].entries[0]).toEqual({ athleteId: 14650473, name: "A", mark: "13:40.00", place: 1, qualified: false });
    expect(races[1].entries[0].athleteId).toBeNull(); // opake IDs werden ignoriert
    expect(combinedPlace(races, "13:40.00", { id: 14650473 })).toBe(2);
  });

  it("liest Rennen aus der HTML-Seite (eingebettete Daten, nur das gesuchte Event)", () => {
    const data = {
      props: { pageProps: { events: [
        { eventId: 1, races: [{ race: "Final", results: [{ mark: "1:00.00", competitor: { name: "anderes Event" } }] }] },
        { eventId: 2, races: [
          { race: "Final 1", results: [{ mark: "8:00.00", competitor: { name: "X" } }] },
          { race: "Final 2", results: [{ mark: "7:59.00", competitor: { name: "Y" } }] },
        ] },
      ] } },
    };
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
    expect(combinedPlace(extractRacesFromHtml(html, 2), "8:00.00")).toBe(2);
  });

  it("liest Rennen aus HTML-Tabellen (Format der alten WA-Seite)", () => {
    const html = `
      <strong>Final<!-- --> 1</strong>
      <table>
        <tr><td>1.</td><td>7</td><td class="EventResults_name__x"><a href="/athletes/germany/a-14650473">A</a></td><td>GER</td><td>13:40.10</td></tr>
        <tr><td>2.</td><td>3</td><td class="EventResults_name__x"><a href="/athletes/germany/b-14984080">B</a></td><td>GER</td><td>13:41.00</td></tr>
      </table>
      <strong>Final<!-- --> 2</strong>
      <table><tr><td>1.</td><td>5</td><td class="EventResults_name__x"><a href="/athletes/kenya/c-14000001">C</a></td><td>KEN</td><td>13:39.00</td></tr></table>`;
    const races = extractRacesFromHtml(html);
    expect(races.map((r) => [r.name, r.entries.map((e) => e.mark)])).toEqual([
      ["Final 1", ["13:40.10", "13:41.00"]], ["Final 2", ["13:39.00"]],
    ]);
    expect(combinedPlace(races, "13:41.00", { name: "B" })).toBe(3);
  });
});
