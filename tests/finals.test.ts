import { describe, expect, it } from "vitest";
import {
  combinedPlace, extractRacesFromHtml, extractRacesFromJson, isFinalRaceName, isSplitFinal, parseMark, type Race,
} from "../importer/finals";

const entry = (mark: string, name = "x") => ({ athleteId: null, name, mark });

describe("kombinierte Finalplatzierung", () => {
  it("parst Zeiten", () => {
    expect(parseMark("46.12")).toBe(46.12);
    expect(parseMark("1:46.60")).toBeCloseTo(106.6);
    expect(parseMark("13:45.23")).toBeCloseTo(825.23);
    expect(parseMark("2:10:33")).toBe(7833);
    expect(parseMark("13:45.23 PB")).toBeCloseTo(825.23);
    expect(parseMark("DNF")).toBeNull();
  });

  it("erkennt Finalläufe", () => {
    expect(isSplitFinal("F1")).toBe(true);
    expect(isSplitFinal("F")).toBe(false);
    expect(isSplitFinal("SF1")).toBe(false);
    expect(["Final 1", "Final A", "F2", "Final"].every(isFinalRaceName)).toBe(true);
    expect(["Semi-Final 1", "Heat 2"].some(isFinalRaceName)).toBe(false);
  });

  it("Beispiel: Platz 5 in F1, zwei Schnellere in F2 -> Platz 7", () => {
    const races: Race[] = [
      { name: "Heat 1", entries: [entry("13:20.00")] }, // Vorläufe zählen nicht
      { name: "Final 1", entries: ["13:40.00", "13:41.00", "13:42.00", "13:43.00", "13:44.00", "13:50.00", "DNF"].map((m) => entry(m)) },
      { name: "Final 2", entries: ["13:38.00", "13:43.50", "13:46.00", "14:10.00"].map((m) => entry(m)) },
    ];
    expect(combinedPlace(races, "13:44.00")).toBe(7);
    // gleiche Zeit = gleicher Platz
    expect(combinedPlace([...races, { name: "Final 3", entries: [entry("13:44.00")] }], "13:44.00")).toBe(7);
  });

  it("gibt null zurück, wenn die Daten nicht passen", () => {
    expect(combinedPlace([{ name: "Final 1", entries: [entry("13:40.00")] }], "13:40.00")).toBeNull(); // nur ein Lauf
    expect(combinedPlace([{ name: "Final 1", entries: [entry("13:40.00")] }, { name: "Final 2", entries: [entry("13:50.00")] }], "13:45.00")).toBeNull();
    expect(combinedPlace([], "DNF")).toBeNull();
  });

  it("liest Rennen aus API-JSON", () => {
    const json = {
      events: [{
        eventId: 10229609,
        races: [
          { race: "Final 1", results: [{ competitor: { id: 14650473, name: "A" }, mark: "13:40.00", place: "1" }] },
          { race: "Final 2", results: [{ competitor: { id: 14984080, name: "B" }, mark: "13:30.00", place: "1" }] },
        ],
      }],
    };
    const races = extractRacesFromJson(json);
    expect(races.map((r) => r.name)).toEqual(["Final 1", "Final 2"]);
    expect(races[0].entries[0]).toEqual({ athleteId: 14650473, name: "A", mark: "13:40.00" });
    expect(combinedPlace(races, "13:40.00")).toBe(2);
  });

  it("liest Rennen aus der HTML-Seite (nur das gesuchte Event)", () => {
    const data = {
      props: { pageProps: { events: [
        { eventId: 1, races: [{ race: "Final 1", results: [{ mark: "1:00.00", competitor: { name: "anderes Event" } }] }] },
        { eventId: 2, races: [
          { race: "Final 1", results: [{ mark: "8:00.00", competitor: { name: "X" } }] },
          { race: "Final 2", results: [{ mark: "7:59.00", competitor: { name: "Y" } }] },
        ] },
      ] } },
    };
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
    expect(combinedPlace(extractRacesFromHtml(html, 2), "8:00.00")).toBe(2);
  });

  it("liest Rennen aus HTML-Tabellen", () => {
    const html = `
      <strong>Final<!-- --> 1</strong>
      <table><tr><td>1.</td><td><a href="/athletes/germany/a-14650473">A</a></td><td>3:40.10</td></tr>
             <tr><td>2.</td><td><a href="/athletes/germany/b-14984080">B</a></td><td>3:41.00</td></tr></table>
      <strong>Final<!-- --> 2</strong>
      <table><tr><td>1.</td><td><a href="/athletes/germany/c-14000001">C</a></td><td>3:39.00</td></tr></table>`;
    const races = extractRacesFromHtml(html);
    expect(races.map((r) => [r.name, r.entries.length])).toEqual([["Final 1", 2], ["Final 2", 1]]);
    expect(combinedPlace(races, "3:41.00")).toBe(3);
  });
});
