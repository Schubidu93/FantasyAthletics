// Rekorde (DR, ER, WR) an Ergebnissen ab 2025 kennzeichnen – aus den All-time-Listen von World Athletics
// (Deutschland, Europa, Welt; alle Leistungen statt nur der besten je Athlet). Erkennt auch Rekorde,
// die inzwischen wieder verbessert wurden. Täglich im Ablauf „Athletenpool laden“.
import { TOPLIST_DISCIPLINES } from "./disciplines";
import { recordMarks } from "./records";
import { adminClient, rpc } from "./supabase";
import { fetchAllTime, sleep, type Gender, type Region } from "./wa";

const db = adminClient();
const SINCE = "2025-01-01";
const REGIONS: [string, Region][] = [["DR", { regionType: "countries", region: "germany" }],
  ["ER", { regionType: "area", region: "europe" }], ["WR", { regionType: "world" }]];

// eigener Ablauf ohne sync_status: ein Fehler hier soll in der App nicht als Ergebnis-Fehler erscheinen
const main = async () => {
  const found: { athlete_id: string; discipline: string; date: string; mark: string; record: string }[] = [];
  const failures: string[] = [];
  let lists = 0;
  for (const d of TOPLIST_DISCIPLINES) {
    for (const gender of ["M", "W"] as Gender[]) {
      for (const [rec, region] of REGIONS) {
        try {
          const rows = await fetchAllTime(d.path, gender, region, SINCE);
          lists++;
          for (const r of recordMarks(rows, SINCE)) {
            found.push({ athlete_id: `wa-${r.athleteId}`, discipline: d.name, date: r.date!, mark: r.mark, record: rec });
            console.log(`${rec} ${d.name} ${gender}: ${r.name} ${r.mark} (${r.date})`);
          }
        } catch (e) {
          failures.push(`${rec} ${d.name} ${gender}: ${(e as Error).message}`);
        }
        await sleep(800);
      }
    }
  }
  if (failures.length > lists) throw new Error(`Zu viele Fehler:\n${failures.slice(0, 20).join("\n")}`);
  const marked = found.length ? await rpc<number>(db, "apply_records", { p_rows: found }) : 0;
  return `Rekorde: ${lists} All-time-Listen gelesen, ${found.length} Rekordleistungen seit ${SINCE}, ${marked} Ergebnisse neu gekennzeichnet` +
    (failures.length ? `\n${failures.length} Fehler:\n${failures.slice(0, 20).join("\n")}` : "");
};

try {
  console.log(await main());
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e));
  process.exitCode = 1;
}
