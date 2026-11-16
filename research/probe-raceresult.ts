// Erkundung RaceResult (läuft in GitHub Actions): robots.txt, Nutzungsbedingungen und Aufbau einer
// öffentlichen Ergebnisliste (my.raceresult.com). Nur wenige Aufrufe mit Pausen.
// Ergebnis: research/out/raceresult/log.txt (+ Beispiel-JSON)
import * as cheerio from "cheerio";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "research/out/raceresult";
mkdirSync(OUT, { recursive: true });
const UA = { "User-Agent": "Mozilla/5.0 (compatible; RunnerFantasy/1.0; Freundesliga, einmalige Erkundung)" };
const log: string[] = [];
const say = (s: string) => { console.log(s); log.push(s); };
process.on("exit", () => writeFileSync(`${OUT}/log.txt`, log.join("\n")));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string) {
  await sleep(2000);
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow" });
    return { status: res.status, url: res.url, text: await res.text() };
  } catch (e) {
    return { status: 0, url, text: String(e) };
  }
}
const textOf = (html: string) => { const $ = cheerio.load(html); $("script, style").remove(); return $("body").text().replace(/\s+/g, " ").trim(); };
const linksOf = (html: string, base: string) => { const $ = cheerio.load(html); return [...new Set($("a[href]").toArray().map((a) => { try { return new URL($(a).attr("href")!, base).href; } catch { return ""; } }).filter(Boolean))]; };

// 1. robots.txt
for (const u of ["https://my.raceresult.com/robots.txt", "https://www.raceresult.com/robots.txt"]) {
  const r = await get(u);
  say(`== ${u} (${r.status})\n${r.text.slice(0, 1500)}`);
}

// 2. Startseiten, Links zu Bedingungen
const home = await get("https://my.raceresult.com/");
say(`== my.raceresult.com (${home.status}) ${textOf(home.text).slice(0, 800)}`);
const www = await get("https://www.raceresult.com/de-de/home/index.php");
const legal = [...linksOf(home.text, home.url), ...linksOf(www.text, www.url)]
  .filter((l) => /agb|terms|nutzung|bedingung|impressum|imprint|legal|datenschutz|privacy|api|developer/i.test(l));
say(`Links Bedingungen: ${[...new Set(legal)].join(" ")}`);
for (const l of [...new Set(legal)].slice(0, 8)) {
  const r = await get(l);
  const t = textOf(r.text);
  const hits = t.split(/(?<=[.!?])\s+/).filter((s) => /automat|crawl|scrap|robot|bot|api|kopier|vervielf|datenbank|database|reproduc|extract|auslesen|ergebnis|result/i.test(s));
  say(`== ${l} (${r.status}, ${t.length} Zeichen)\n${hits.slice(0, 25).join("\n")}`);
}

// 3. Aufbau einer öffentlichen Ergebnisliste: Veranstaltung von der Startseite
const ids = [...new Set([...home.text.matchAll(/my\.raceresult\.com\/(\d{5,7})/g), ...home.text.matchAll(/href="\/(\d{5,7})\//g)].map((m) => m[1]))];
say(`Veranstaltungs-IDs auf der Startseite: ${ids.slice(0, 20).join(", ")}`);
for (const id of ids.slice(0, 2)) {
  const page = await get(`https://my.raceresult.com/${id}/results`);
  say(`== Veranstaltung ${id}: ${page.status} ${page.url}; Skripte: ${[...page.text.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 8).join(" ")}`);
  for (const u of [`https://my.raceresult.com/${id}/RRPublish/data/config?page=results&noVisitor=1`, `https://my.raceresult.com/${id}/results/config?lang=de`]) {
    const cfg = await get(u);
    say(`config ${u}: ${cfg.status} ${cfg.text.slice(0, 1500)}`);
    if (cfg.status === 200 && cfg.text.startsWith("{")) {
      writeFileSync(`${OUT}/config-${id}.json`, cfg.text);
      const c = JSON.parse(cfg.text);
      const list = (c.lists ?? c.TabConfig?.Lists ?? [])[0];
      say(`Listen: ${JSON.stringify(c.lists ?? c.TabConfig?.Lists ?? null).slice(0, 800)}; Wettbewerbe: ${JSON.stringify(c.contests ?? null).slice(0, 400)}; key=${c.key ? "ja" : "nein"}; server=${c.server ?? ""}`);
      if (list && c.key) {
        const lu = `https://my.raceresult.com/${id}/RRPublish/data/list?key=${c.key}&listname=${encodeURIComponent(list.Name ?? list.ID)}&page=results&contest=${list.Contest ?? 0}&r=all&l=0`;
        const data = await get(lu);
        writeFileSync(`${OUT}/list-${id}.json`, data.text.slice(0, 200000));
        say(`Liste: ${data.status} ${data.text.slice(0, 1500)}`);
      }
      break;
    }
  }
}
