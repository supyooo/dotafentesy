import { Module } from "@nestjs/common";
import { DbModule } from "./db.module.js";
import { HealthController } from "./health/health.controller.js";

// Модули = домены docs/09 (catalog, tournaments, scoring, lineups, …) — добавляются с B1.
@Module({ imports: [DbModule], controllers: [HealthController] })
export class AppModule {}
