import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import type { Fetched } from "@df/sources";

/** Сырой ответ → raw_payloads; одинаковый ответ второй раз не пишем (docs/09). true — записан новый. */
export async function saveRaw(db: Db, provider: string, resource: string, externalId: string, f: Fetched<unknown>): Promise<boolean> {
  const hash = createHash("sha256").update(JSON.stringify(f.body)).digest();
  const [dup] = await db.select({ one: sql`1` }).from(s.rawPayloads).where(and(eq(s.rawPayloads.provider, provider),
    eq(s.rawPayloads.resource, resource), eq(s.rawPayloads.externalId, externalId), eq(s.rawPayloads.payloadHash, hash))).limit(1);
  if (dup) return false;
  await db.insert(s.rawPayloads).values({ provider, resource, externalId, httpStatus: f.status, payload: f.body, payloadHash: hash });
  return true;
}
