// Прогнозы. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, check, jsonb, pgTable, primaryKey, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { series, stages, tournaments } from "./tournament.js";
import { users } from "./users.js";

/** Вопрос */
export const pickemQuestions = pgTable("pickem_questions", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tournamentId: bigint("tournament_id", { mode: "number" }).notNull().references(() => tournaments.id),
    stageId: bigint("stage_id", { mode: "number" }).notNull().references(() => stages.id),
    seriesId: bigint("series_id", { mode: "number" }).references(() => series.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    options: jsonb("options").notNull(),
    maxPoints: smallint("max_points").notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    correct: jsonb("correct"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [
  check("pickem_questions_kind_check", sql`${t.kind} in ('series', 'two_of', 'one_of')`),
]);

/** Ответ менеджера */
export const pickemAnswers = pgTable("pickem_answers", {
    questionId: bigint("question_id", { mode: "number" }).references(() => pickemQuestions.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    answer: jsonb("answer").notNull(),
    points: smallint("points"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.questionId, t.userId] }),
]);

/** Итог прогнозов за турнир */
export const pickemResults = pgTable("pickem_results", {
    tournamentId: bigint("tournament_id", { mode: "number" }).references(() => tournaments.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    points: smallint("points").notNull(),
    maxPoints: smallint("max_points").notNull(),
    medal: text("medal"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tournamentId, t.userId] }),
  check("pickem_results_medal_check", sql`${t.medal} in ('bronze', 'silver', 'gold', 'platinum')`),
]);
