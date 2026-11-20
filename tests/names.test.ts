// Namen wie in den WA-Toplisten (Nachname groß) – damit ein Namenswechsel im WA-Profil (z. B. nach Hochzeit) erkannt wird
import { describe, expect, it } from "vitest";
import { waName } from "../importer/wa";

describe("Namen aus dem WA-Profil", () => {
  it("Vorname normal, Nachname groß wie in den Toplisten", () => {
    expect(waName("Yemisi", "Mabry")).toBe("Yemisi MABRY");
    expect(waName("Adrian", "König-Rannenberg")).toBe("Adrian KÖNIG-RANNENBERG");
    expect(waName(" Robert ", "FARKEN")).toBe("Robert FARKEN");
    expect(waName(null, "Ehlers")).toBe("EHLERS");
  });
});
