// Toplisten: Platz nach der Zeit, nicht nach WA-Punkten
import { expect, it } from "vitest";
import { athlete, freshDb } from "./db";
it("Topliste nach Zeit", async () => {
  const db = await freshDb();
  for (const [id, mark, score] of [[1, "3:37.73", 1180], [2, "3:36.15", 1170], [3, "3:30.09", 1243]] as const) {
    await athlete(db, id, `A${id}`, "men", "1500 Metres", score, 2026);
    await db.query("update toplist_entries set mark = $1 where athlete_id = $2", [mark, `wa-${id}`]);
  }
  expect((await db.all("select rank, mark from toplist(2025, '1500 Metres', 'men')")).map((r) => `${r.rank}. ${r.mark}`))
    .toEqual(["1. 3:30.09", "2. 3:36.15", "3. 3:37.73"]);
  expect((await db.one("select rank from athlete_toplists('wa-2')")).rank).toBe(2);
  await db.end();
});
