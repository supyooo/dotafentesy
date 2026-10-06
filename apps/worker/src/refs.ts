import { and, eq } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";

export async function findRef(db: Db, entityType: string, provider: string, externalId: string | number): Promise<number | null> {
  const [r] = await db.select({ id: s.externalRefs.entityId }).from(s.externalRefs).where(and(eq(s.externalRefs.provider, provider),
    eq(s.externalRefs.entityType, entityType), eq(s.externalRefs.externalId, String(externalId))));
  return r?.id ?? null;
}

export async function addRef(db: Db, entityType: string, entityId: number, provider: string, externalId: string | number, url?: string) {
  await db.insert(s.externalRefs).values({ entityType, entityId, provider, externalId: String(externalId), url }).onConflictDoNothing();
}
