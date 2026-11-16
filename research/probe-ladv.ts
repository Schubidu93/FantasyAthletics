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

// 2. Lauf: Nutzungsbedingungen und Aufbau der Leistungsdatenbank
for (const [name, url] of [
  ["nutzungsbedingungen", "https://ladv.de/page/view/nutzungsbedingungen.htm"],
  ["agb", "https://ladv.de/page/view/agb.htm"],
  ["impressum", "https://ladv.de/page/view/impressum.htm"],
  ["leistungsdatenbank", "https://ladv.de/leistungsdatenbank"],
  ["athletenprofil", "https://ladv.de/leistungsdatenbank/athletenprofil"],
  ["hilfe", "https://ladv.de/hilfe"],
]) await page(url, name);
// Sitemap der Athleten: nur Aufbau (erste Zeichen)
await sleep(2000);
const sm = await fetch("https://ladv.de/sitemap/athletindex", { headers: UA }).then((r) => r.text()).catch((e) => String(e));
writeFileSync(`${OUT}/sitemap-athletindex.txt`, sm.slice(0, 20000));
say(`sitemap/athletindex: ${sm.length} Zeichen; Anfang: ${sm.slice(0, 600)}`);
