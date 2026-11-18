// Spieltag-Vorschläge je nach Bereichen der Liga (web/sport/matchday-plan.js)
import { describe, expect, it } from "vitest";
// @ts-expect-error – reines JavaScript der App
import { championshipLabel, monthlyProposal, seasonProposal, withChampionshipMatchdays } from "../web/sport/matchday-plan.js";

const ev = (name: string, start: string, end = start, category = "B") => ({ name, start_date: start, end_date: end, category });
const EVENTS = [
  ev("German Athletics Championships", "2027-07-24", "2027-07-25"),
  ev("SPAR European Cross Country Championships", "2027-12-12"),
  ev("German Combined Events Championships", "2027-06-19", "2027-06-20"),
  ev("German Winter Throwing Championships", "2027-03-13", "2027-03-14"),
];
const names = (l: { name: string }[]) => l.map((m) => m.name);
type Md = { name: string; starts_on: string; ends_on: string };

describe("Spieltag-Vorschläge je Liga", () => {
  it("Fachmeisterschaften nur, wenn die Liga nichts anderes spielt", () => {
    const cross = EVENTS[1], mk = EVENTS[2], ww = EVENTS[3];
    expect([championshipLabel(cross, ["Lauf"]), championshipLabel(cross, ["Lauf", "Sprint"]), championshipLabel(cross)])
      .toEqual(["Cross-EM", null, "Cross-EM"]);
    expect([championshipLabel(mk, ["Mehrkampf"]), championshipLabel(mk, ["Lauf"])]).toEqual(["Mehrkampf-DM", null]);
    expect([championshipLabel(ww, ["Wurf"]), championshipLabel(ww, ["Wurf", "Sprung"])]).toEqual(["Winterwurf-DM", null]);
    expect(championshipLabel(EVENTS[0], ["Wurf"])).toBe("DM");
  });

  it("Laufliga wie bisher: Cross-EM eigener Spieltag, Herbst und Winter mit Monaten", () => {
    const l: Md[] = monthlyProposal("2027-01-01", "2027-12-31", EVENTS, ["Lauf"]);
    expect(names(l)).toContain("Cross-EM");
    expect(names(l)).toContain("November");
    expect(names(l)).not.toContain("Saisonpause");
  });

  it("ohne Lauf: Saisonpause ab Oktober, keine Cross-EM", () => {
    const l: Md[] = monthlyProposal("2027-01-01", "2027-12-31", EVENTS, ["Sprint", "Sprung", "Wurf"]);
    expect(names(l)).not.toContain("Cross-EM");
    const pause = l.find((m) => m.name === "Saisonpause")!;
    expect(pause.ends_on).toBe("2027-12-31");
    expect(pause.starts_on >= "2027-09-25" && pause.starts_on <= "2027-10-04").toBe(true);
    expect(names(l).filter((n) => /Oktober|November|Dezember/.test(n))).toEqual([]);
    // lückenlos
    for (let i = 1; i < l.length; i++) expect(Date.parse(l[i].starts_on) - Date.parse(l[i - 1].ends_on)).toBe(864e5);
  });

  it("Saisonblöcke ohne Lauf: September und Saisonpause; Wurfliga mit Winterwurf-DM", () => {
    expect(names(seasonProposal("2027-01-01", "2027-12-31", ["Wurf"])).slice(-2)).toEqual(["September", "Saisonpause"]);
    expect(names(seasonProposal("2027-01-01", "2027-12-31", ["Lauf"])).slice(-2)).toEqual(["Herbst", "Winter"]);
    const l: Md[] = withChampionshipMatchdays(seasonProposal("2027-01-01", "2027-12-31", ["Wurf"]), "2027-01-01", "2027-12-31", EVENTS, { areas: ["Wurf"] });
    expect(names(l)).toEqual(expect.arrayContaining(["Winterwurf-DM", "DM"]));
  });
});
