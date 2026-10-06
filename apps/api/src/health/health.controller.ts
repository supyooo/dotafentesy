import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { ping, type Db } from "@df/db";
import { RULESET_B } from "@df/domain";
import { InjectDb } from "../db.module.js";

@Controller("health")
export class HealthController {
  constructor(@InjectDb() private readonly db: Db) {}

  @Get()
  async health() {
    try {
      const pg = await ping(this.db);
      // Redis (BullMQ) пока не установлен — см. docs/11; появится вместе с worker
      return { status: "ok", postgres: pg, redis: "not_configured", scoring_ruleset: RULESET_B.version };
    } catch (e) {
      throw new HttpException({ status: "down", postgres: String((e as Error).message) }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
