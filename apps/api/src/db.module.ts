import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, type Db, type Pool } from "@df/db";

export const DB = Symbol("DB");
export const PG_POOL = Symbol("PG_POOL");
export const InjectDb = () => Inject(DB);

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/dota_fantasy";
const conn = createDb(url);

@Global()
@Module({
  providers: [{ provide: DB, useValue: conn.db }, { provide: PG_POOL, useValue: conn.pool }],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() { await this.pool.end(); }
}
export type { Db };
