// Findet alle sichtbaren deutschen Texte der App (für das niederländische Wörterbuch, tests/i18n.test.ts):
// - Text zwischen Tags in html`…`-Vorlagen; eingesetzte Werte ${…} werden zu {} (so stehen die Sätze auch im Wörterbuch)
// - title/placeholder/aria-label/alt in Vorlagen
// - Zeichenketten im Code ('…', "…", `…`), die nach deutschem Text aussehen (Beschriftungen, Meldungen)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ESC: Record<string, string> = { n: "\n", t: "\t" };
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
// sieht nach deutschem Text aus (mind. ein Wort mit Kleinbuchstaben, kein Code)
const GERMAN = /[äöüßÄÖÜ]|\b(der|die|das|und|oder|nicht|nur|mit|für|von|ein|eine|einen|noch|kein|keine|ist|sind|wird|werden|bis|ab|alle|neu|zum|zur|im|am|auf|aus|bei|nach|vor|über|unter|pro|je|du|dein|deine|dich|dir|wir|sich|hier|jetzt|sofort|dann|danach|den|dem|des|dazu|auch|wie|wer|was|wenn|sie|er|es|man|sein|ihr|ihre|beim|vom|zu|um|gibt|hat|haben|kann|darf|muss|gilt|zählt|seit|schon|mehr|weniger|bitte|beliebige|neue|letzte|nächste|erste|Uhr|Tage|Woche|Monat|Jahr)\b/i;
// Beschriftung: beginnt mit einem großgeschriebenen Wort, danach nur Wörter (z. B. „Termin speichern“)
const LABEL = /^[„(]?[A-ZÄÖÜ][a-zäöüß]+[\wäöüßÄÖÜ.,:;!?()„“–\-+/' …]*$/u;
const CODE = /^[\w.#:/-]*$|=>|\bconst\b|\breturn\b|[{};]\s*$|^https?:|^\.|^#|^[a-z]+(\.[a-z]+)+|^[a-z_]+$|var\(--|\d(px|rem|em|%)/;

export function isGerman(s: string): boolean {
  const t = s.replace(/\{\}/g, " ").trim();
  if (!/[a-zA-ZäöüÄÖÜß]{2}/.test(t)) return false;
  if (/^https?:|var\(--|=>|^[A-Z][a-zA-Z]+[A-Z]\w*$/.test(s)) return false;   // Links, CSS, Code, Namen wie „RiderCell“
  if (LABEL.test(t)) return true;
  if (CODE.test(s.replace(/\{\}/g, ""))) return false;   // eingesetzte Werte {} sind kein Code
  return GERMAN.test(t);
}
/** Text zwischen Tags: alles mit Buchstaben ist sichtbarer Text */
const isText = (s: string) => /[a-zA-ZäöüÄÖÜß]{2}/.test(s.replace(/\{\}/g, " "));

/** Text einer Vorlage ab Index i (nach dem `) bis zum schließenden ` – liefert Endindex; sammelt Texte und Attribute */
function scanHtml(src: string, i: number, out: Set<string>): number {
  let text = "", inTag = false, quote = "", attr = "";
  const flush = () => { const t = norm(text); if (isText(t)) out.add(t); text = ""; };
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") { const c = ESC[src[i + 1]] ?? src[i + 1]; if (!inTag) text += c; else if (quote) attr += c; i += 2; continue; }
    if (ch === "`") { if (!inTag) flush(); return i + 1; }
    if (ch === "$" && src[i + 1] === "{") {
      const start = i + 2;
      i = scanExpr(src, start, out, false, !inTag);
      // eingebettete Vorlagen (html`…`) werden eigene Elemente: Satz endet dort, sonst eingesetzter Wert {}
      if (!inTag) { if (src.slice(start, i).includes("html`")) flush(); else text += "{}"; }
      else if (quote) attr += "{}";
      continue;
    }
    if (inTag) {
      if (quote) {
        if (ch === quote) { const m = /(title|placeholder|aria-label|alt)=$/.exec(src.slice(Math.max(0, i - attr.length - 20), i - attr.length - 1));
          if (m && isGerman(attr)) out.add(norm(attr)); quote = ""; attr = ""; }
        else attr += ch;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") inTag = false;
    } else if (ch === "<") { flush(); inTag = true; }
    else text += ch;
    i++;
  }
  return i;
}

/** JavaScript-Ausdruck bis zur passenden } (bzw. Dateiende) – sammelt Zeichenketten und eingebettete Vorlagen */
// rendered: Ausdruck steht als Text in einer Vorlage – dann zählen auch einzelne kleingeschriebene Wörter als Ergebnis
// (nach ||, ??, ? oder :, z. B. x.name || 'offen'), nicht aber Vergleichswerte (=== 'live')
function scanExpr(src: string, i: number, out: Set<string>, top = false, rendered = false): number {
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 2; continue; }
    if (ch === "'" || ch === '"') {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== ch) { if (src[j] === "\\") { s += ESC[src[j + 1]] ?? src[j + 1]; j += 2; } else s += src[j++]; }
      const before = src.slice(Math.max(0, i - 4), i).trimEnd();
      if (isGerman(s) || (rendered && /(\|\||\?\?|[?:])$/.test(before) && /^[a-zäöüß]+( [a-zäöüß]+)*$/.test(s))) out.add(norm(s));
      i = j + 1; continue;
    }
    if (ch === "`") {
      if (/html$/.test(src.slice(Math.max(0, i - 4), i))) { i = scanHtml(src, i + 1, out); continue; }
      // normale Vorlage: Text mit {} für eingesetzte Werte
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") { s += ESC[src[j + 1]] ?? src[j + 1]; j += 2; }
        else if (src[j] === "$" && src[j + 1] === "{") { j = scanExpr(src, j + 2, out); s += "{}"; }
        else s += src[j++];
      }
      if (isGerman(s)) out.add(norm(s));
      i = j + 1; continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") { if (depth === 0 && !top) return i + 1; depth--; }
    i++;
  }
  return i;
}

const files = (dir: string, skip: (n: string) => boolean): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === "vendor" ? [] : files(join(dir, e.name), skip)) : e.name.endsWith(".js") && !skip(e.name) ? [join(dir, e.name)] : []);

/** Alle deutschen Texte der App (ohne vendor und das Wörterbuch selbst) */
export function germanTexts(web: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const f of files(web, (n) => n.startsWith("i18n-"))) {
    const out = new Set<string>();
    const src = readFileSync(f, "utf8").replace(/^\s*(import|export \{)[^;]*;/gm, "");
    scanExpr(src, 0, out, true);
    for (const t of out) found.set(t, [...(found.get(t) ?? []), f.slice(web.length + 1)]);
  }
  return found;
}
