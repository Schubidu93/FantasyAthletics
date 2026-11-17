// Athlet hinzufügen (Admin → Athleten): offene Aufträge aus athlete_requests abarbeiten.
//   Eingabe: WA-ID, Link zum WA-Profil („…/athletes/germany/tom-thurley-14682657“) oder Name.
//   Name → searchCompetitors; genau ein Treffer (oder genau einer mit gleichem Namen) wird übernommen, sonst „mehrdeutig“ mit Vorschlägen.
//   Stammdaten aus getSingleCompetitor (basicData) → athletes (manual = true, damit immer im Pool).
// Aufruf: `tsx importer/add-athlete.ts` (schreibt ATHLETE_IDS nach $GITHUB_ENV für die nächsten Schritte)
//         `tsx importer/add-athlete.ts --finish` (Aufträge auf „fertig“ setzen, Pool neu bilden)
import { appendFileSync } from "node:fs";
import { idFromQuery } from "./add-athlete-id";
import { normalizeName } from "./placings";
import { adminClient, rpc } from "./supabase";
import { discoverApiConfig, parseWaDate, sleep, type ApiConfig } from "./wa";

const db = adminClient();
type Req = { id: number; query: string; gender: "men" | "women"; status: string };
type Hit = { id: number; name: string; country: string | null; birth: string | null; gender: string | null };


async function gql<T>(api: ApiConfig, query: string, variables: Record<string, unknown>): Promise<T> {
  await sleep(700);
  const res = await fetch(api.url, { method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": api.key, "User-Agent": "Mozilla/5.0 (compatible; FantasyAthletics/2.0)" },
    body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`WA-API ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data as T;
}

async function search(api: ApiConfig, q: string, gender: string): Promise<Hit[]> {
  // Hinweis: der gender-Parameter der Suche erwartet einen eigenen Enum-Wert – wir filtern selbst („Men“/„Women“)
  const data = await gql<{ searchCompetitors?: Record<string, unknown>[] }>(api,
    `query($q: String) { searchCompetitors(query: $q) { aaAthleteId givenName familyName gender country birthDate } }`, { q });
  const want = gender === "women" ? "women" : "men";
  return (data.searchCompetitors ?? []).filter((h) => !h.gender || String(h.gender).toLowerCase() === want).map((h) => ({
    id: Number(h.aaAthleteId), name: `${h.givenName ?? ""} ${h.familyName ?? ""}`.trim(),
    country: (h.country as string) ?? null, birth: (h.birthDate as string) ?? null, gender: (h.gender as string) ?? null,
  })).filter((h) => h.id);
}

async function basic(api: ApiConfig, id: number) {
  const data = await gql<{ getSingleCompetitor?: { basicData?: Record<string, string | null> } }>(api,
    `query($id: Int) { getSingleCompetitor(id: $id) { basicData { givenName familyName countryCode birthDate } } }`, { id });
  const b = data.getSingleCompetitor?.basicData;
  if (!b?.familyName) throw new Error(`Keine Daten für WA-ID ${id}`);
  return { name: `${b.givenName ?? ""} ${b.familyName}`.trim(), nation: b.countryCode ?? null, birth: parseWaDate(b.birthDate ?? "") };
}

const finish = process.argv.includes("--finish");

const main = async () => {
  if (finish) {
    await rpc(db, "refresh_pool", {});
    const { data } = await db.from("athlete_requests").update({ status: "fertig", done_at: new Date().toISOString() })
      .eq("status", "läuft").select("id");
    return `Athlet hinzufügen: ${data?.length ?? 0} Aufträge fertig, Pool neu gebildet`;
  }
  const { data: reqs, error } = await db.from("athlete_requests").select("id, query, gender, status").eq("status", "offen").order("id");
  if (error) throw new Error(error.message);
  if (!reqs?.length) return "Keine offenen Aufträge";
  const api: ApiConfig = process.env.WA_API_URL && process.env.WA_API_KEY
    ? { url: process.env.WA_API_URL, key: process.env.WA_API_KEY } : await discoverApiConfig();
  const ids: string[] = [];
  const log: string[] = [];
  for (const r of reqs as Req[]) {
    const set = (patch: Record<string, unknown>) => db.from("athlete_requests").update(patch).eq("id", r.id);
    try {
      let id = idFromQuery(r.query);
      if (!id) {
        const hits = await search(api, r.query, r.gender);
        const exact = hits.filter((h) => normalizeName(h.name) === normalizeName(r.query));
        // Suche ist unscharf (findet auch „Hurley“ bei „Thurley“): alle Wörter der Eingabe müssen im Namen stehen
        const words = normalizeName(r.query).split(" ");
        const all = hits.filter((h) => words.every((w) => normalizeName(h.name).includes(w)));
        const pick = exact.length === 1 ? exact[0] : all.length === 1 ? all[0] : hits.length === 1 ? hits[0] : null;
        // Vorschläge: passende zuerst, deutsche Athleten vor anderen
        hits.sort((a, b) => Number(all.includes(b)) - Number(all.includes(a)) || Number(b.country === "GER") - Number(a.country === "GER"));
        if (!pick) {
          const list = hits.slice(0, 6).map((h) => `${h.name} (${[h.country, h.birth?.slice(-4), `ID ${h.id}`].filter(Boolean).join(", ")})`);
          await set({ status: hits.length ? "mehrdeutig" : "fehler", done_at: new Date().toISOString(),
            message: hits.length ? `Mehrere Treffer – bitte mit WA-ID neu anlegen: ${list.join("; ")}` : "Kein Athlet mit diesem Namen gefunden." });
          log.push(`${r.query}: ${hits.length} Treffer`);
          continue;
        }
        id = pick.id;
      }
      const b = await basic(api, id);
      const slug = `wa-${id}`;
      const { error: e } = await db.from("athletes").upsert({ id: slug, wa_id: id, name: b.name, gender: r.gender, nation: b.nation,
        ...(b.birth ? { birth_date: b.birth } : {}), manual: true, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (e) throw new Error(e.message);
      await set({ status: "läuft", athlete_id: slug, message: `${b.name} (${b.nation ?? "?"}) angelegt, Ergebnisse werden geladen …` });
      ids.push(slug);
      log.push(`${r.query} → ${b.name} (${slug})`);
    } catch (err) {
      await set({ status: "fehler", done_at: new Date().toISOString(), message: (err as Error).message.slice(0, 300) });
      log.push(`${r.query}: Fehler ${(err as Error).message}`);
    }
  }
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `ATHLETE_IDS=${ids.join(",")}\n`);
  return `Athlet hinzufügen:\n${log.join("\n")}`;
};

try {
  console.log(await main());
} catch (e) {
  console.error(e instanceof Error ? (e.stack ?? e.message) : JSON.stringify(e));
  process.exitCode = 1;
}
