// Kalender: Bereiche im Wettkampfprogramm erkennen (Beispiele aus echten WA-Programmen)
import { describe, expect, it } from "vitest";
import { calendarAreas, eventArea, irrelevantChampionship, nameAreas, runningEvents, seniorEvents } from "../importer/calendar-filter";
import { eventGroup } from "../web/sport/groups.js";

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
  it("ordnet jede Disziplin für Erwachsene einem Bereich zu", () => {
    expect(["100m", "400mH", "110mH", "1500m", "3000mSC", "Long Jump", "Pole Vault", "Shot Put", "Hammer Throw", "Decathlon",
      "20 km Race Walk", "Mile", "60m", "Half Marathon"].map(eventArea))
      .toEqual(["Sprint", "Hürden", "Hürden", "Lauf", "Lauf", "Sprung", "Sprung", "Wurf", "Wurf", "Mehrkampf", "Gehen", "Lauf", "Sprint", "Lauf"]);
    expect(seniorEvents(["100m U20", "4x100m", "Long Jump", "Masters 800m", "Senior Race"])).toEqual(["Long Jump"]);
  });
  it("ordnet Programm-Disziplinen den Schwerpunkt-Disziplinen zu (Disziplin-Filter im Kalender)", () => {
    expect(["60m", "300m", "110mH", "400mH", "1000m", "Mile", "3000m", "3000mSC", "10,000m", "5 km Road", "Half Marathon",
      "Cross Country", "High Jump", "Shot Put", "Heptathlon", "Half Marathon Race Walk"].map(eventGroup))
      .toEqual(["100", "400", "Kurzhürden", "Langhürden", "800", "1500", "5000", "Hindernis", "10000", "5000", "Marathon",
        "10000", "Hochsprung", "Kugel", "Mehrkampf", "Gehen"]);
  });

  it("Bereiche eines Wettkampfs: Programm, sonst Art und Name", () => {
    expect(calendarAreas([{ events: ["1500m", "Long Jump"] }, { events: ["Javelin Throw", "100m"] }], ["track"], "Meeting"))
      .toEqual(["Lauf", "Sprint", "Sprung", "Wurf"]);
    expect(calendarAreas(null, ["road"], "Berlin-Marathon")).toEqual(["Lauf"]);
    expect(calendarAreas(null, ["track"], "Hylo Javelin Meeting")).toEqual(["Wurf"]);
    expect(calendarAreas(null, ["track"], "Night of Hasbergen")).toBeNull();   // Name verrät nichts → unbekannt
    expect(nameAreas("2. LTR Wurf-Festival")).toEqual(["Wurf"]);
    expect(nameAreas("German Combined Events Championships")).toEqual(["Mehrkampf"]);
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
