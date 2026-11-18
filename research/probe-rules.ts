// Erkundung: WA-Ranking-Regeln für Mehrkampf und Gehen sichern (Platzierungstabellen für die Erweiterung auf alle
// Disziplinen). Ergebnis: research/out/rules/<seite>.txt – danach python3 research/build_placing_sql.py
import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";
import { sleep } from "../importer/wa";

const OUT = "research/out/rules";
mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" };

function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer").remove();
  const lines: string[] = [];
  $("h1, h2, h3, h4, h5, p, li, table").each((_, el) => {
    if (el.tagName === "table") {
      $(el).find("tr").each((__, tr) => {
        lines.push($(tr).find("th, td").toArray().map((c) => $(c).text().replace(/\s+/g, " ").trim()).join(" | "));
      });
      lines.push("");
    } else if (!$(el).parents("table").length) {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (t) lines.push(el.tagName.startsWith("h") ? `\n## ${t}` : t);
    }
  });
  return lines.join("\n");
}

for (const slug of ["combined-events-2026", "race-walking-2026", "race-walks-2026"]) {
  const res = await fetch(`https://worldathletics.org/world-ranking-rules/${slug}`, { headers: UA });
  const text = await res.text();
  console.log(`${slug}: ${res.status}, ${text.length} Zeichen`);
  if (res.ok) writeFileSync(`${OUT}/${slug}.txt`, pageText(text));
  await sleep(1500);
}
