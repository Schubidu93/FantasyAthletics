import { createClient } from "@supabase/supabase-js";

export function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein");
  return createClient(url, key, { auth: { persistSession: false } });
}

export type Db = ReturnType<typeof adminClient>;

export async function chunked<T>(items: T[], size: number, fn: (chunk: T[]) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await fn(items.slice(i, i + size));
}

/** Protokolliert einen Importlauf in `import_runs`. */
export async function logRun(db: Db, kind: "pool" | "results", run: () => Promise<string>) {
  const { data } = await db.from("import_runs").insert({ kind }).select("id").single();
  try {
    const message = await run();
    console.log(message);
    await db.from("import_runs").update({ finished_at: new Date().toISOString(), ok: true, message }).eq("id", data?.id);
  } catch (e) {
    const message = (e as Error).stack ?? String(e);
    console.error(message);
    await db.from("import_runs").update({ finished_at: new Date().toISOString(), ok: false, message }).eq("id", data?.id);
    process.exitCode = 1;
  }
}

/** Jahre der laufenden (nicht beendeten) Saisons, ersatzweise das aktuelle Jahr. */
export async function activeSeasons(db: Db) {
  const { data, error } = await db.from("seasons").select("id, year, pool_threshold").neq("status", "finished");
  if (error) throw error;
  return data.length ? data : [{ id: null, year: new Date().getFullYear(), pool_threshold: 1000 }];
}
