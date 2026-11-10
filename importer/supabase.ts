import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL und SUPABASE_SERVICE_KEY müssen gesetzt sein");
  return createClient(url, key, { auth: { persistSession: false } });
}

export type Db = ReturnType<typeof adminClient>;

export async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Alle Zeilen einer Abfrage (die API liefert max. 1000 pro Anfrage). */
export async function selectAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) return out;
  }
}

export async function rpc<T = unknown>(db: Db, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Ablauf mit Statusmeldung in sync_status (wird oben in der App angezeigt). */
export async function run(db: Db, fn: () => Promise<string>) {
  try {
    console.log(await fn());
  } catch (e) {
    const message = (e as Error).stack ?? String(e);
    console.error(message);
    await db.from("sync_status").update({ last_run: new Date().toISOString(), ok: false, message: message.slice(0, 500) }).eq("id", 1);
    process.exitCode = 1;
  }
}

/** Jahr des Athletenpools bzw. der Ergebnisse: aktuelles Jahr (Europe/Berlin). */
export const currentYear = () => Number(new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }).slice(0, 4));
