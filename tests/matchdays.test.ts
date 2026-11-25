// Spieltag-Vorschläge je nach Bereichen der Liga (web/sport/matchday-plan.js)
import { describe, expect, it } from "vitest";
// @ts-expect-error – reines JavaScript der App
import { championshipLabel, missingChampionships, monthlyProposal, seasonProposal, withChampionshipMatchdays, withExtraChampionships } from "../web/sport/matchday-plan.js";

const ev = (name: string, start: string, end = start, category = "B") => ({ name, start_date: start, end_date: end, category });
const EVENTS = [
  ev("German Athletics Championships", "2027-07-24", "2027-07-25"),
  ev("SPAR European Cross Country Championships", "2027-12-12"),
  ev("German Combined Events Championships", "2027-06-19", "2027-06-20"),
  ev("German Winter Throwing Championships", "2027-03-13", "2027-03-14"),
];
const names = (l: { name: string }[]) => l.map((m) => m.name);
const addOne = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
type Md = { name: string; starts_on: string; ends_on: string };

describe("Spieltag-Vorschläge je Liga", () => {
  it("zu kurze Reste (z. B. eine Woche zwischen Hallen-DM und Hallen-EM) gehen im vorherigen Spieltag auf", () => {
    const evs = [ev("German Indoor Championships", "2027-02-20", "2027-02-21"), ev("European Athletics Indoor Championships", "2027-03-04", "2027-03-07", "GL")];
    const l: Md[] = monthlyProposal("2027-01-01", "2027-12-31", evs, ["Lauf", "Sprint"]);
    const hdm = l.find((m) => m.name === "Hallen-DM")!;
    expect(hdm.ends_on).toBe(addOne(l.find((m) => m.name === "Hallen-EM")!.starts_on, -1));
    expect(l.every((m) => (Date.parse(m.ends_on) - Date.parse(m.starts_on)) / 864e5 + 1 >= 7)).toBe(true);
    expect(names(l)).not.toContain("Februar II");
  });

  it("Landesmeisterschaften nach dem Land der Liga: NK statt DM in niederländischen Ligen", () => {
    const evs = [...EVENTS, ev("Dutch Championships", "2027-07-31", "2027-08-01"), ev("Dutch Indoor Championships", "2027-02-27", "2027-02-28"),
      ev("Dutch Combined Events Championships", "2027-07-03", "2027-07-04"), ev("ASICS Dutch U20 Championships", "2027-06-25"),
      ev("SplitTime NK Teams", "2027-05-29")];
    const nl: Md[] = monthlyProposal("2027-01-01", "2027-12-31", evs, ["Lauf"], "NED");
    expect(names(nl)).toEqual(expect.arrayContaining(["NK", "NK indoor"]));
    expect(names(nl).some((n) => /DM/.test(n))).toBe(false);
    expect(championshipLabel(evs[6], ["Mehrkampf"], "NED")).toBe("NK meerkamp");
    expect([championshipLabel(evs[7], null, "NED"), championshipLabel(evs[8], null, "NED")]).toEqual([null, null]);
    const de: Md[] = monthlyProposal("2027-01-01", "2027-12-31", evs, ["Lauf"]);
    expect(names(de)).toContain("DM");
    expect(names(de).some((n) => /NK/.test(n))).toBe(false);
    // Termine aus der Terminliste des Verbands nur für das eigene Land; fehlende werden gemeldet
    const dlv = [{ name: "Deutsche Hallenmeisterschaften", start_date: "2027-02-19", end_date: "2027-02-21", source_url: "x" }];
    expect(withExtraChampionships([], dlv, "NED")).toEqual([]);
    expect(missingChampionships("2027-01-01", "2027-12-31", [], "NED")).toEqual(["NK indoor 2027", "NK 2027"]);
  });

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
