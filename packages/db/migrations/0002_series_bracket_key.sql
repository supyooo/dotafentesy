ALTER TABLE "series" ADD COLUMN "bracket_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "series_tournament_id_bracket_key_uq" ON "series" USING btree ("tournament_id","bracket_key");