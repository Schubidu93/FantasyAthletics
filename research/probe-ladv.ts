// Erkundung LADV (läuft in GitHub Actions): Nutzungsbedingungen, robots.txt, API-Dokumentation,
// Aufbau von Athletenprofilen und Suche. Nur wenige Seitenaufrufe mit Pausen.
// Ergebnis: research/out/ladv/*.txt und log.txt
import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "research/out/ladv";
mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Mozilla/5.0 (compatible; RunnerFantasy/1.0; Freundesliga, einmalige Erkundung)" };
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
process.on("exit", () => writeFileSync(`${OUT}/log.txt`, log.join("\n")));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let n = 0;
async function page(url: string, name: string) {
  if (++n > 30) return null;
  await sleep(2000);
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow" });
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style").remove();
    const text = $("body").text().replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
    const links = [...new Set($("a[href]").toArray().map((a) => new URL($(a).attr("href")!, res.url).href))];
    writeFileSync(`${OUT}/${name}.txt`, `${res.status} ${res.url}\n\n${text}\n\nLINKS:\n${links.join("\n")}`);
    say(`${name}: ${res.status} ${res.url} (${text.length} Zeichen, ${links.length} Links)`);
    return { res, html, text, links };
  } catch (e) {
    say(`${name}: FEHLER ${(e as Error).message}`);
    return null;
  }
}

// 3. Lauf: Entwickler-/API-Dokumentation (nur Dokumentationsseiten, nicht /api/ selbst)
const dev = await page("https://ladv.de/entwickler", "entwickler");
const docs = (dev?.links ?? []).filter((l) => /ladv\.de\/(entwickler|page|hilfe)/.test(l) && !/\/api\//.test(l));
say(`Dokulinks: ${docs.join(" ")}`);
for (const [i, l] of docs.slice(0, 10).entries()) await page(l, `entwickler-${i}`);
