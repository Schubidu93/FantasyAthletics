import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dirname, "..", "supabase", "migrations");

// Minimaler Nachbau dessen, was Supabase vor unseren Migrationen bereitstellt.
const SUPABASE_STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create publication supabase_realtime;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return db;
}

export async function createUser(db: PGlite, name: string) {
  const id = crypto.randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name}@example.com`]);
  return id;
}

export async function as(db: PGlite, userId: string | null) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []) {
  const res = await db.query<T>(sql, params);
  return res.rows[0];
}
