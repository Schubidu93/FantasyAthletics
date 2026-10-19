import { describe, expect, it } from "vitest";
import { athleteIdFromHref, mapResult, parsePlace, parseToplist, parseWaDate, toplistUrl } from "../importer/wa";

const TOPLIST_HTML = `
<table class="records-table"><thead><tr><th>Rank</th></tr></thead><tbody>
  <tr>
    <td data-th="Rank">1</td><td data-th="Mark">3:33.12</td><td data-th="WIND"></td>
    <td data-th="Competitor"><a href="/athletes/germany/robert-farken-14650473">Robert  FARKEN</a></td>
    <td data-th="DOB">20 SEP 1997</td><td data-th="Nat">GER</td>
    <td data-th="ResultScore">1236</td>
  </tr>
  <tr>
    <td data-th="Rank">2</td><td data-th="Mark">3:40.00</td>
    <td data-th="Competitor"><a href="https://worldathletics.org/athletes/athlete=14914521">Malik SKUPIN-ALFA</a></td>
    <td data-th="DOB"></td><td data-th="ResultScore">1100</td>
  </tr>
</tbody></table>`;

describe("WA-Parser", () => {
  it("liest Toplisten-Zeilen", () => {
    expect(parseToplist(TOPLIST_HTML)).toEqual([
      { athleteId: 14650473, name: "Robert FARKEN", birthYear: 1997, mark: "3:33.12", score: 1236 },
      { athleteId: 14914521, name: "Malik SKUPIN-ALFA", birthYear: null, mark: "3:40.00", score: 1100 },
    ]);
  });

  it("baut Toplisten-URLs", () => {
    expect(toplistUrl("middlelong/1500-metres", "W", 2026, "ger", 2)).toBe(
      "https://worldathletics.org/records/toplists/middlelong/1500-metres/all/women/senior/2026" +
        "?regionType=countries&region=ger&page=2&bestResultsOnly=true&maxResultsByCountry=all&ageCategory=senior",
    );
  });

  it("parst Daten, Plätze und IDs", () => {
    expect(parseWaDate("18 OCT 2026")).toBe("2026-10-18");
    expect(parseWaDate("5 Jan 2026")).toBe("2026-01-05");
    expect(parseWaDate("")).toBeNull();
    expect(parsePlace("12.")).toBe(12);
    expect(parsePlace("DNF")).toBeNull();
    expect(athleteIdFromHref("/athletes/germany/alexander-stepanov-14984080")).toBe(14984080);
  });

  it("mappt API-Ergebnisse", () => {
    expect(mapResult({
      date: "20 MAR 2026", competition: "World Indoor", venue: "Toruń (POL) (i)", discipline: "800 Metres Short Track",
      country: "POL", category: "GW", race: "H3", place: "", mark: "1:46.60", resultScore: 1182, remark: "",
      competitionId: 7190000, eventId: 10229556,
    })).toEqual({
      date: "2026-03-20", competition: "World Indoor", venue: "Toruń (POL) (i)", discipline: "800 Metres Short Track",
      country: "POL", category: "GW", race: "H3", place: null, mark: "1:46.60", resultScore: 1182, remark: null,
      competitionId: 7190000, eventId: 10229556,
    });
  });
});
