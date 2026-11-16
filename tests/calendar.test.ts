// Kalender: Laufdisziplinen ab 800 m im Wettkampfprogramm erkennen (Beispiele aus echten WA-Programmen)
import { describe, expect, it } from "vitest";
import { NOT_RUNNING, irrelevantChampionship, runningEvents } from "../importer/calendar-filter";

describe("Kalender", () => {
  it("erkennt Laufdisziplinen ab 800 m im Programm", () => {
    expect(runningEvents(["100m", "400m", "1500m", "400mH", "3000mSC", "Long Jump", "Discus Throw"])).toEqual(["1500m", "3000mSC"]);
    expect(runningEvents(["100m", "200m", "800m U20", "4x100m U20", "800m U16", "Hammer Throw"])).toEqual([]);
    expect(runningEvents(["5 km Road"])).toEqual(["5 km Road"]);
    expect(runningEvents(["Half Marathon", "Marathon", "10 km Road", "10 Kilometres Road"])).toHaveLength(4);
    expect(runningEvents(["Decathlon", "Heptathlon", "Pole Vault"])).toEqual([]);
    expect(runningEvents(["800m", "Mile", "5000m", "10,000m", "4x800m", "20 km Race Walk"])).toEqual(["800m", "Mile", "5000m", "10,000m"]);
    expect(runningEvents(["Cross Country 10km", "Senior Race"])).toEqual(["Cross Country 10km"]);
  });
  it("ohne Programm: Name", () => {
    expect(NOT_RUNNING.test("22. NetAachen Domspringen")).toBe(false);   // Name verrät es nicht – Programm nötig
    expect(NOT_RUNNING.test("Hylo Javelin Meeting")).toBe(true);
    expect(NOT_RUNNING.test("2. LTR Wurf-Festival")).toBe(true);
    expect(NOT_RUNNING.test("Night of Hasbergen")).toBe(false);
  });

  it("lässt Meisterschaften anderer Kontinente und Länder weg", () => {
    expect(irrelevantChampionship({ name: "Asian Athletics Championships", area: "Asia", country: "KOR" })).toBe(true);
    expect(irrelevantChampionship({ name: "Oceania Championships", area: "Oceania", country: "AUS" })).toBe(true);
    expect(irrelevantChampionship({ name: "Campeonato", area: "South America", country: "BRA", competitionGroup: "Area Senior Outdoor Championships" })).toBe(true);
    expect(irrelevantChampionship({ name: "USATF Championships", area: "North and Central America", country: "USA", competitionGroup: "National Senior Championships" })).toBe(true);
    expect(irrelevantChampionship({ name: "European Athletics Championships", area: "Europe", country: "GBR", competitionGroup: "Area Senior Outdoor Championships" })).toBe(false);
    expect(irrelevantChampionship({ name: "German Championships", area: "Europe", country: "GER", competitionGroup: "National Senior Championships" })).toBe(false);
    expect(irrelevantChampionship({ name: "World Athletics Championships", area: "Asia", country: "CHN", competitionGroup: "World Athletics Championships" })).toBe(false);
    expect(irrelevantChampionship({ name: "Wanda Diamond League", area: "Asia", country: "CHN", competitionGroup: "Wanda Diamond League" })).toBe(false);
  });
});
