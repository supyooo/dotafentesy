CREATE TABLE "teams" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "tag" text NOT NULL,
  "country_code" char(2),
  "logo_url" text,
  "updated_at" timestamptz NOT NULL
);

CREATE TABLE "players" (
  "id" bigint PRIMARY KEY,
  "nickname" text NOT NULL,
  "real_name" text,
  "country_code" char(2),
  "steam_account_id" bigint UNIQUE,
  "photo_url" text,
  "photo_license" text,
  "updated_at" timestamptz NOT NULL
);

CREATE TABLE "team_rosters" (
  "id" bigint PRIMARY KEY,
  "team_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "position" smallint,
  "role" text NOT NULL,
  "valid_from" date NOT NULL,
  "valid_to" date
);

CREATE TABLE "heroes" (
  "id" smallint PRIMARY KEY,
  "code" text NOT NULL,
  "name_ru" text NOT NULL,
  "icon_url" text
);

CREATE TABLE "external_refs" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" bigint NOT NULL,
  "provider" text NOT NULL,
  "external_id" text NOT NULL,
  "url" text
);

CREATE TABLE "organizers" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text UNIQUE
);

CREATE TABLE "seasons" (
  "id" bigint PRIMARY KEY,
  "name" text NOT NULL,
  "starts_on" date NOT NULL,
  "ends_on" date,
  "status" text NOT NULL,
  "config" jsonb NOT NULL
);

CREATE TABLE "tournaments" (
  "id" bigint PRIMARY KEY,
  "season_id" bigint,
  "organizer_id" bigint,
  "slug" text UNIQUE,
  "name" text NOT NULL,
  "tier" smallint NOT NULL,
  "prize_pool_usd" integer,
  "location" text,
  "starts_at" timestamptz,
  "ends_at" timestamptz,
  "status" text NOT NULL,
  "is_league_round" boolean NOT NULL,
  "skin" text,
  "scoring_ruleset_id" bigint NOT NULL,
  "config" jsonb NOT NULL
);

CREATE TABLE "stages" (
  "id" bigint PRIMARY KEY,
  "tournament_id" bigint NOT NULL,
  "idx" smallint NOT NULL,
  "name" text NOT NULL,
  "format" text NOT NULL,
  "deadline_at" timestamptz,
  "starts_at" timestamptz,
  "ends_at" timestamptz,
  "status" text NOT NULL
);

CREATE TABLE "stage_groups" (
  "id" bigint PRIMARY KEY,
  "stage_id" bigint NOT NULL,
  "label" text NOT NULL
);

CREATE TABLE "tournament_teams" (
  "tournament_id" bigint,
  "team_id" bigint,
  "seed" smallint,
  "group_id" bigint,
  "status" text NOT NULL,
  "eliminated_after_stage_id" bigint,
  "final_place" smallint,
  PRIMARY KEY ("tournament_id", "team_id")
);

CREATE TABLE "series" (
  "id" bigint PRIMARY KEY,
  "tournament_id" bigint NOT NULL,
  "stage_id" bigint NOT NULL,
  "group_id" bigint,
  "round_label" text NOT NULL,
  "bracket_side" text,
  "round_no" smallint,
  "slot" smallint,
  "best_of" smallint NOT NULL,
  "team_a_id" bigint,
  "team_b_id" bigint,
  "score_a" smallint NOT NULL,
  "score_b" smallint NOT NULL,
  "winner_team_id" bigint,
  "status" text NOT NULL,
  "scheduled_at" timestamptz,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "next_win_series_id" bigint,
  "next_lose_series_id" bigint
);

CREATE TABLE "streams" (
  "id" bigint PRIMARY KEY,
  "tournament_id" bigint NOT NULL,
  "series_id" bigint,
  "platform" text NOT NULL,
  "url" text NOT NULL,
  "language" text
);

CREATE TABLE "maps" (
  "id" bigint PRIMARY KEY,
  "series_id" bigint NOT NULL,
  "map_no" smallint NOT NULL,
  "dota_match_id" bigint UNIQUE,
  "radiant_team_id" bigint,
  "dire_team_id" bigint,
  "winner_team_id" bigint,
  "duration_s" integer,
  "started_at" timestamptz,
  "ended_at" timestamptz,
  "status" text NOT NULL,
  "data_tier" text NOT NULL,
  "parsed_at" timestamptz
);

CREATE TABLE "map_draft" (
  "map_id" bigint,
  "order_no" smallint,
  "team_id" bigint NOT NULL,
  "hero_id" smallint NOT NULL,
  "is_pick" boolean NOT NULL,
  PRIMARY KEY ("map_id", "order_no")
);

CREATE TABLE "player_map_stats" (
  "map_id" bigint,
  "player_id" bigint,
  "team_id" bigint NOT NULL,
  "hero_id" smallint,
  "is_radiant" boolean NOT NULL,
  "won" boolean,
  "kills" smallint NOT NULL,
  "deaths" smallint NOT NULL,
  "assists" smallint NOT NULL,
  "last_hits" smallint NOT NULL,
  "denies" smallint NOT NULL,
  "gpm" smallint,
  "xpm" smallint,
  "net_worth" integer,
  "hero_damage" integer,
  "building_damage" integer,
  "hero_healing" integer,
  "obs_placed" smallint,
  "obs_killed" smallint,
  "stun_s" numeric(6,1),
  "camps_stacked" smallint,
  "data_tier" text NOT NULL,
  "extra" jsonb,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("map_id", "player_id")
);

CREATE TABLE "raw_payloads" (
  "id" bigint PRIMARY KEY,
  "provider" text NOT NULL,
  "resource" text NOT NULL,
  "external_id" text,
  "fetched_at" timestamptz NOT NULL,
  "http_status" smallint,
  "payload" jsonb NOT NULL,
  "payload_hash" bytea NOT NULL
);

CREATE TABLE "ingest_runs" (
  "id" bigint PRIMARY KEY,
  "job" text NOT NULL,
  "provider" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "status" text NOT NULL,
  "items_seen" integer,
  "items_changed" integer,
  "error" text
);

CREATE TABLE "data_overrides" (
  "id" bigint PRIMARY KEY,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "field" text NOT NULL,
  "value" jsonb NOT NULL,
  "reason" text NOT NULL,
  "created_by" bigint NOT NULL,
  "created_at" timestamptz NOT NULL
);

CREATE TABLE "scoring_rulesets" (
  "id" bigint PRIMARY KEY,
  "version" text UNIQUE,
  "rules" jsonb NOT NULL,
  "role_coefs" jsonb NOT NULL,
  "published_at" timestamptz,
  "notes" text
);

CREATE TABLE "tournament_players" (
  "id" bigint PRIMARY KEY,
  "tournament_id" bigint NOT NULL,
  "player_id" bigint NOT NULL,
  "team_id" bigint NOT NULL,
  "position" smallint NOT NULL,
  "is_active" boolean NOT NULL,
  "start_rating" numeric(5,2),
  "start_price" numeric(4,1) NOT NULL
);

CREATE TABLE "player_prices" (
  "tournament_player_id" bigint,
  "stage_id" bigint,
  "price" numeric(4,1) NOT NULL,
  "change" numeric(3,1) NOT NULL,
  "reason" text,
  PRIMARY KEY ("tournament_player_id", "stage_id")
);

CREATE TABLE "player_map_points" (
  "map_id" bigint,
  "tournament_player_id" bigint,
  "ruleset_id" bigint,
  "raw_points" numeric(7,2) NOT NULL,
  "points" numeric(7,2) NOT NULL,
  "breakdown" jsonb NOT NULL,
  "data_tier" text NOT NULL,
  "computed_at" timestamptz NOT NULL,
  PRIMARY KEY ("map_id", "tournament_player_id", "ruleset_id")
);

CREATE TABLE "player_stage_points" (
  "tournament_player_id" bigint,
  "stage_id" bigint,
  "points" numeric(7,2) NOT NULL,
  "maps_played" smallint NOT NULL,
  "ownership_pct" numeric(5,2),
  PRIMARY KEY ("tournament_player_id", "stage_id")
);

CREATE TABLE "users" (
  "id" bigint PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "nickname" text NOT NULL,
  "avatar_hue" smallint,
  "favorite_team_id" bigint,
  "locale" text NOT NULL,
  "role" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "deleted_at" timestamptz
);

CREATE TABLE "auth_identities" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "provider" text NOT NULL,
  "provider_uid" text NOT NULL,
  "verified_at" timestamptz
);

CREATE TABLE "user_sessions" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "token_hash" bytea UNIQUE,
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "last_seen_at" timestamptz
);

CREATE TABLE "notification_prefs" (
  "user_id" bigint PRIMARY KEY,
  "round_open" boolean NOT NULL,
  "deadline_reminder" boolean NOT NULL,
  "round_result" boolean NOT NULL,
  "replay_parsed" boolean NOT NULL,
  "channels" jsonb NOT NULL
);

CREATE TABLE "lineups" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "tournament_id" bigint NOT NULL,
  "bank" numeric(4,1) NOT NULL,
  "free_transfers" smallint NOT NULL,
  "captain_position" smallint,
  "chip_pending" text NOT NULL,
  "triple_used_stage_id" bigint,
  "wildcard_used_stage_id" bigint,
  "first_completed_at" timestamptz,
  "total_points" numeric(8,2) NOT NULL,
  "updated_at" timestamptz NOT NULL
);

CREATE TABLE "lineup_slots" (
  "lineup_id" bigint,
  "position" smallint,
  "tournament_player_id" bigint NOT NULL,
  "bought_price" numeric(4,1) NOT NULL,
  PRIMARY KEY ("lineup_id", "position")
);

CREATE TABLE "lineup_locks" (
  "id" bigint PRIMARY KEY,
  "lineup_id" bigint NOT NULL,
  "stage_id" bigint NOT NULL,
  "captain_tp_id" bigint NOT NULL,
  "chip" text NOT NULL,
  "free_used" smallint NOT NULL,
  "paid_transfers" smallint NOT NULL,
  "penalty" numeric(5,1) NOT NULL,
  "locked_at" timestamptz NOT NULL
);

CREATE TABLE "lineup_lock_slots" (
  "lock_id" bigint,
  "position" smallint,
  "tournament_player_id" bigint NOT NULL,
  "price_at_lock" numeric(4,1) NOT NULL,
  PRIMARY KEY ("lock_id", "position")
);

CREATE TABLE "transfers" (
  "id" bigint PRIMARY KEY,
  "lineup_id" bigint NOT NULL,
  "stage_id" bigint NOT NULL,
  "position" smallint NOT NULL,
  "out_tp_id" bigint NOT NULL,
  "in_tp_id" bigint NOT NULL,
  "out_price" numeric(4,1) NOT NULL,
  "in_price" numeric(4,1) NOT NULL,
  "kind" text NOT NULL
);

CREATE TABLE "lineup_stage_scores" (
  "lineup_id" bigint,
  "stage_id" bigint,
  "points" numeric(8,2) NOT NULL,
  "data_tier" text NOT NULL,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("lineup_id", "stage_id")
);

CREATE TABLE "tournament_standings" (
  "tournament_id" bigint,
  "lineup_id" bigint,
  "total_points" numeric(8,2) NOT NULL,
  "rank" integer NOT NULL,
  "prev_rank" integer,
  "tiebreak" jsonb NOT NULL,
  "is_final" boolean NOT NULL,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("tournament_id", "lineup_id")
);

CREATE TABLE "mini_leagues" (
  "id" bigint PRIMARY KEY,
  "code" text UNIQUE,
  "name" text NOT NULL,
  "owner_user_id" bigint NOT NULL,
  "scope" text NOT NULL,
  "tournament_id" bigint,
  "season_id" bigint,
  "created_at" timestamptz NOT NULL
);

CREATE TABLE "mini_league_members" (
  "mini_league_id" bigint,
  "user_id" bigint,
  "joined_at" timestamptz NOT NULL,
  PRIMARY KEY ("mini_league_id", "user_id")
);

CREATE TABLE "pickem_questions" (
  "id" bigint PRIMARY KEY,
  "tournament_id" bigint NOT NULL,
  "stage_id" bigint NOT NULL,
  "series_id" bigint,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "options" jsonb NOT NULL,
  "max_points" smallint NOT NULL,
  "closes_at" timestamptz NOT NULL,
  "correct" jsonb,
  "resolved_at" timestamptz
);

CREATE TABLE "pickem_answers" (
  "question_id" bigint,
  "user_id" bigint,
  "answer" jsonb NOT NULL,
  "points" smallint,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("question_id", "user_id")
);

CREATE TABLE "pickem_results" (
  "tournament_id" bigint,
  "user_id" bigint,
  "points" smallint NOT NULL,
  "max_points" smallint NOT NULL,
  "medal" text,
  "updated_at" timestamptz NOT NULL,
  PRIMARY KEY ("tournament_id", "user_id")
);

CREATE TABLE "league_tiers" (
  "id" smallint PRIMARY KEY,
  "code" text UNIQUE,
  "name_ru" text NOT NULL
);

CREATE TABLE "season_ladders" (
  "season_id" bigint,
  "tier_id" smallint,
  "is_active" boolean NOT NULL,
  PRIMARY KEY ("season_id", "tier_id")
);

CREATE TABLE "league_memberships" (
  "season_id" bigint,
  "user_id" bigint,
  "tier_id" smallint,
  "skip_streak" smallint NOT NULL,
  "best_tier_id" smallint,
  "calibrated_at" timestamptz,
  PRIMARY KEY ("season_id", "user_id")
);

CREATE TABLE "league_rounds" (
  "id" bigint PRIMARY KEY,
  "season_id" bigint NOT NULL,
  "tournament_id" bigint UNIQUE,
  "round_no" smallint NOT NULL,
  "status" text NOT NULL,
  "groups_formed_at" timestamptz,
  "settled_at" timestamptz
);

CREATE TABLE "league_groups" (
  "id" bigint PRIMARY KEY,
  "round_id" bigint NOT NULL,
  "tier_id" smallint NOT NULL,
  "group_no" smallint NOT NULL,
  "pooled_key" text,
  "zone_up" smallint NOT NULL,
  "zone_down" smallint NOT NULL
);

CREATE TABLE "league_group_members" (
  "group_id" bigint,
  "user_id" bigint,
  "round_id" bigint NOT NULL,
  "lineup_id" bigint NOT NULL,
  "tier_at_start" smallint NOT NULL,
  "place" smallint,
  "zone" text,
  "tier_after" smallint,
  PRIMARY KEY ("group_id", "user_id")
);

CREATE TABLE "titan_round_points" (
  "round_id" bigint,
  "user_id" bigint,
  "season_id" bigint NOT NULL,
  "place" smallint NOT NULL,
  "f1_points" smallint NOT NULL,
  PRIMARY KEY ("round_id", "user_id")
);

CREATE TABLE "season_titles" (
  "id" bigint PRIMARY KEY,
  "season_id" bigint NOT NULL,
  "user_id" bigint NOT NULL,
  "title" text NOT NULL,
  "tier_id" smallint,
  "awarded_at" timestamptz NOT NULL
);

CREATE TABLE "achievements" (
  "id" bigint PRIMARY KEY,
  "code" text UNIQUE,
  "name_ru" text NOT NULL,
  "category" text NOT NULL,
  "tiers" jsonb
);

CREATE TABLE "user_achievements" (
  "user_id" bigint,
  "achievement_id" bigint,
  "tier" smallint NOT NULL,
  "earned_at" timestamptz NOT NULL,
  "context" jsonb,
  PRIMARY KEY ("user_id", "achievement_id")
);

CREATE TABLE "trophies" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "kind" text NOT NULL,
  "tournament_id" bigint,
  "season_id" bigint,
  "label" text NOT NULL,
  "awarded_at" timestamptz NOT NULL
);

CREATE TABLE "notifications" (
  "id" bigint PRIMARY KEY,
  "user_id" bigint NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "channel" text NOT NULL,
  "created_at" timestamptz NOT NULL,
  "sent_at" timestamptz,
  "read_at" timestamptz
);

CREATE TABLE "tenants" (
  "id" bigint PRIMARY KEY,
  "slug" text UNIQUE,
  "name" text NOT NULL,
  "branding" jsonb,
  "is_default" boolean NOT NULL
);

CREATE TABLE "api_clients" (
  "id" bigint PRIMARY KEY,
  "tenant_id" bigint NOT NULL,
  "name" text NOT NULL,
  "key_hash" bytea UNIQUE,
  "scopes" text[] NOT NULL,
  "rate_limit_per_min" integer NOT NULL,
  "revoked_at" timestamptz
);

CREATE TABLE "webhook_subscriptions" (
  "id" bigint PRIMARY KEY,
  "api_client_id" bigint NOT NULL,
  "url" text NOT NULL,
  "events" text[] NOT NULL,
  "secret_hash" bytea NOT NULL,
  "is_active" boolean NOT NULL
);

CREATE TABLE "webhook_deliveries" (
  "id" bigint PRIMARY KEY,
  "subscription_id" bigint NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL,
  "attempts" smallint NOT NULL,
  "next_attempt_at" timestamptz,
  "delivered_at" timestamptz
);

CREATE INDEX ON "team_rosters" ("player_id", "valid_to");

CREATE UNIQUE INDEX ON "external_refs" ("provider", "entity_type", "external_id");

CREATE INDEX ON "external_refs" ("entity_type", "entity_id");

CREATE UNIQUE INDEX ON "stages" ("tournament_id", "idx");

CREATE INDEX ON "series" ("tournament_id", "stage_id");

CREATE INDEX ON "series" ("status");

CREATE UNIQUE INDEX ON "maps" ("series_id", "map_no");

CREATE INDEX ON "player_map_stats" ("player_id");

CREATE UNIQUE INDEX ON "raw_payloads" ("provider", "resource", "external_id", "payload_hash", "fetched_at");

CREATE UNIQUE INDEX ON "tournament_players" ("tournament_id", "player_id");

CREATE UNIQUE INDEX ON "auth_identities" ("provider", "provider_uid");

CREATE UNIQUE INDEX ON "lineups" ("user_id", "tournament_id");

CREATE UNIQUE INDEX ON "lineup_locks" ("lineup_id", "stage_id");

CREATE INDEX ON "lineup_lock_slots" ("tournament_player_id");

CREATE INDEX ON "tournament_standings" ("tournament_id", "rank");

CREATE UNIQUE INDEX ON "league_group_members" ("round_id", "user_id");

COMMENT ON TABLE "teams" IS 'Команда';

COMMENT ON COLUMN "teams"."tag" IS 'TS, PARI…';

COMMENT ON COLUMN "teams"."logo_url" IS 'свой файл, не логотип организатора';

COMMENT ON TABLE "players" IS 'Игрок про-сцены';

COMMENT ON COLUMN "players"."nickname" IS 'текущий ник; ники меняются — не ключ';

COMMENT ON COLUMN "players"."steam_account_id" IS 'account_id (Steam32) — главный ключ сопоставления';

COMMENT ON COLUMN "players"."photo_license" IS 'источник и права на фото';

COMMENT ON TABLE "team_rosters" IS 'Кто за какую команду играл и когда';

COMMENT ON COLUMN "team_rosters"."position" IS '1–5';

COMMENT ON COLUMN "team_rosters"."role" IS 'player | standin | coach';

COMMENT ON COLUMN "team_rosters"."valid_to" IS 'null — состав актуален';

COMMENT ON TABLE "heroes" IS 'Герои Dota';

COMMENT ON COLUMN "heroes"."id" IS 'hero_id из игры';

COMMENT ON COLUMN "heroes"."code" IS 'npc_dota_hero_…';

COMMENT ON TABLE "external_refs" IS 'Сопоставление с внешними источниками';

COMMENT ON COLUMN "external_refs"."entity_type" IS 'team | player | tournament | series | map | league';

COMMENT ON COLUMN "external_refs"."entity_id" IS 'id в нашей таблице';

COMMENT ON COLUMN "external_refs"."provider" IS 'liquipedia | opendota | stratz | steam | pandascore | grid';

COMMENT ON TABLE "organizers" IS 'Организатор';

COMMENT ON COLUMN "organizers"."name" IS 'BLAST, PGL, ESL…';

COMMENT ON TABLE "seasons" IS 'Сезон (от TI до TI)';

COMMENT ON COLUMN "seasons"."name" IS '2026/27';

COMMENT ON COLUMN "seasons"."status" IS 'planned | active | finished';

COMMENT ON COLUMN "seasons"."config" IS 'зоны, размер группы, калибровка, F1-очки';

COMMENT ON TABLE "tournaments" IS 'Турнир';

COMMENT ON COLUMN "tournaments"."slug" IS 'blast-slam-9';

COMMENT ON COLUMN "tournaments"."tier" IS '1';

COMMENT ON COLUMN "tournaments"."status" IS 'announced | open | live | finished | cancelled';

COMMENT ON COLUMN "tournaments"."is_league_round" IS 'раунд лиги сезона';

COMMENT ON COLUMN "tournaments"."skin" IS 'оформление';

COMMENT ON COLUMN "tournaments"."scoring_ruleset_id" IS 'правила очков на турнир';

COMMENT ON COLUMN "tournaments"."config" IS 'бюджет, лимиты, трансферы, пороги медалей';

COMMENT ON TABLE "stages" IS 'Стадия (окно → дедлайн → игры)';

COMMENT ON COLUMN "stages"."idx" IS '0, 1, 2…';

COMMENT ON COLUMN "stages"."format" IS 'gsl | swiss | round_robin | double_elim | single_elim';

COMMENT ON COLUMN "stages"."deadline_at" IS 'первая карта стадии';

COMMENT ON COLUMN "stages"."status" IS 'upcoming | open | locked | settling | settled';

COMMENT ON TABLE "stage_groups" IS 'Группа внутри стадии';

COMMENT ON COLUMN "stage_groups"."label" IS 'A, B…';

COMMENT ON TABLE "tournament_teams" IS 'Участник турнира';

COMMENT ON COLUMN "tournament_teams"."status" IS 'active | eliminated';

COMMENT ON TABLE "series" IS 'Серия (узел сетки)';

COMMENT ON COLUMN "series"."round_label" IS '«Верхняя сетка · 1/4»';

COMMENT ON COLUMN "series"."bracket_side" IS 'group | upper | lower | final';

COMMENT ON COLUMN "series"."slot" IS 'позиция в раунде';

COMMENT ON COLUMN "series"."best_of" IS '1 | 2 | 3 | 5';

COMMENT ON COLUMN "series"."team_a_id" IS 'null — ещё не определена';

COMMENT ON COLUMN "series"."score_a" IS '0';

COMMENT ON COLUMN "series"."score_b" IS '0';

COMMENT ON COLUMN "series"."status" IS 'scheduled | live | finished | forfeit | cancelled';

COMMENT ON COLUMN "series"."next_win_series_id" IS 'куда идёт победитель';

COMMENT ON COLUMN "series"."next_lose_series_id" IS 'куда идёт проигравший';

COMMENT ON TABLE "streams" IS 'Трансляции';

COMMENT ON COLUMN "streams"."series_id" IS 'null — канал турнира';

COMMENT ON COLUMN "streams"."platform" IS 'twitch | youtube | vk | kick';

COMMENT ON COLUMN "streams"."language" IS 'ru, en';

COMMENT ON TABLE "maps" IS 'Карта (одна игра серии)';

COMMENT ON COLUMN "maps"."map_no" IS '1…5';

COMMENT ON COLUMN "maps"."dota_match_id" IS 'match_id Valve; null до старта';

COMMENT ON COLUMN "maps"."status" IS 'live | finished | void (ремейк)';

COMMENT ON COLUMN "maps"."data_tier" IS 'live | basic | parsed';

COMMENT ON TABLE "map_draft" IS 'Пики и баны карты';

COMMENT ON TABLE "player_map_stats" IS 'Статистика игрока на карте (сырая, без очков)';

COMMENT ON COLUMN "player_map_stats"."won" IS 'null пока карта идёт';

COMMENT ON COLUMN "player_map_stats"."kills" IS 'live';

COMMENT ON COLUMN "player_map_stats"."deaths" IS 'live';

COMMENT ON COLUMN "player_map_stats"."assists" IS 'live';

COMMENT ON COLUMN "player_map_stats"."last_hits" IS 'live';

COMMENT ON COLUMN "player_map_stats"."denies" IS 'live';

COMMENT ON COLUMN "player_map_stats"."gpm" IS 'live';

COMMENT ON COLUMN "player_map_stats"."xpm" IS 'live';

COMMENT ON COLUMN "player_map_stats"."net_worth" IS 'live';

COMMENT ON COLUMN "player_map_stats"."hero_damage" IS 'конец карты';

COMMENT ON COLUMN "player_map_stats"."building_damage" IS 'конец карты';

COMMENT ON COLUMN "player_map_stats"."hero_healing" IS 'конец карты';

COMMENT ON COLUMN "player_map_stats"."obs_placed" IS 'после разбора';

COMMENT ON COLUMN "player_map_stats"."obs_killed" IS 'после разбора';

COMMENT ON COLUMN "player_map_stats"."stun_s" IS 'после разбора';

COMMENT ON COLUMN "player_map_stats"."camps_stacked" IS 'после разбора';

COMMENT ON COLUMN "player_map_stats"."data_tier" IS 'live | basic | parsed';

COMMENT ON COLUMN "player_map_stats"."extra" IS 'всё остальное из источника';

COMMENT ON TABLE "raw_payloads" IS 'Сырой ответ внешнего API';

COMMENT ON COLUMN "raw_payloads"."resource" IS 'league_matches | match | live_league_games | bracket…';

COMMENT ON COLUMN "raw_payloads"."fetched_at" IS 'ключ партиции';

COMMENT ON COLUMN "raw_payloads"."payload_hash" IS 'дубликаты не пишем';

COMMENT ON TABLE "ingest_runs" IS 'Журнал запусков сборщиков';

COMMENT ON COLUMN "ingest_runs"."status" IS 'ok | partial | failed';

COMMENT ON TABLE "data_overrides" IS 'Ручные правки данных';

COMMENT ON COLUMN "data_overrides"."entity_type" IS 'map | player_map_stats | series | tournament_players…';

COMMENT ON COLUMN "data_overrides"."reason" IS 'стендин, ремейк, ошибка источника';

COMMENT ON TABLE "scoring_rulesets" IS 'Версия правил очков';

COMMENT ON COLUMN "scoring_rulesets"."version" IS '2026.10-a';

COMMENT ON COLUMN "scoring_rulesets"."rules" IS 'очки за статистики';

COMMENT ON COLUMN "scoring_rulesets"."role_coefs" IS 'множители позиций';

COMMENT ON TABLE "tournament_players" IS 'Игрок в пуле турнира';

COMMENT ON COLUMN "tournament_players"."position" IS '1–5, на турнир не меняется';

COMMENT ON COLUMN "tournament_players"."is_active" IS 'false — стендин заменил / снят';

COMMENT ON COLUMN "tournament_players"."start_rating" IS 'внутренний, не показываем';

COMMENT ON COLUMN "tournament_players"."start_price" IS '4.5–12.5';

COMMENT ON TABLE "player_prices" IS 'Цена на начало стадии';

COMMENT ON COLUMN "player_prices"."reason" IS 'очки за карту / вылет (цена заморожена)';

COMMENT ON TABLE "player_map_points" IS 'Очки игрока за карту';

COMMENT ON COLUMN "player_map_points"."points" IS '× множитель позиции';

COMMENT ON COLUMN "player_map_points"."breakdown" IS 'очки по строкам — для «итога карты»';

COMMENT ON COLUMN "player_map_points"."data_tier" IS 'live | basic | parsed';

COMMENT ON TABLE "player_stage_points" IS 'Очки игрока за стадию (сумма)';

COMMENT ON COLUMN "player_stage_points"."ownership_pct" IS 'доля составов с игроком';

COMMENT ON TABLE "users" IS 'Менеджер';

COMMENT ON COLUMN "users"."tenant_id" IS 'свой сайт = тенант по умолчанию';

COMMENT ON COLUMN "users"."locale" IS 'ru';

COMMENT ON COLUMN "users"."role" IS 'user | admin';

COMMENT ON COLUMN "users"."deleted_at" IS 'мягкое удаление';

COMMENT ON TABLE "auth_identities" IS 'Способ входа';

COMMENT ON COLUMN "auth_identities"."provider" IS 'device | telegram | email | vk';

COMMENT ON TABLE "user_sessions" IS 'Сессия';

COMMENT ON TABLE "notification_prefs" IS 'Настройки уведомлений';

COMMENT ON COLUMN "notification_prefs"."deadline_reminder" IS 'за 3 часа, если нет состава';

COMMENT ON COLUMN "notification_prefs"."replay_parsed" IS '«разбор реплея готов»';

COMMENT ON COLUMN "notification_prefs"."channels" IS 'telegram, email, push';

COMMENT ON TABLE "lineups" IS 'Состав менеджера на турнир';

COMMENT ON COLUMN "lineups"."free_transfers" IS '0–2';

COMMENT ON COLUMN "lineups"."captain_position" IS '1–5';

COMMENT ON COLUMN "lineups"."chip_pending" IS 'none | triple | wildcard';

COMMENT ON COLUMN "lineups"."first_completed_at" IS 'для равенства';

COMMENT ON COLUMN "lineups"."total_points" IS 'денормализовано';

COMMENT ON TABLE "lineup_slots" IS 'Текущий черновик (то, что видно в окне)';

COMMENT ON COLUMN "lineup_slots"."position" IS '1–5';

COMMENT ON TABLE "lineup_locks" IS 'Снимок состава в дедлайн стадии';

COMMENT ON COLUMN "lineup_locks"."chip" IS 'none | triple | wildcard';

COMMENT ON TABLE "lineup_lock_slots" IS 'Игроки снимка';

COMMENT ON TABLE "transfers" IS 'Трансферы окна (фиксируются в дедлайн)';

COMMENT ON COLUMN "transfers"."stage_id" IS 'стадия, перед которой окно';

COMMENT ON COLUMN "transfers"."kind" IS 'free | paid | eliminated | guaranteed | wildcard';

COMMENT ON TABLE "lineup_stage_scores" IS 'Очки состава за стадию';

COMMENT ON COLUMN "lineup_stage_scores"."points" IS 'с капитаном и штрафом';

COMMENT ON COLUMN "lineup_stage_scores"."data_tier" IS 'live | basic | parsed';

COMMENT ON TABLE "tournament_standings" IS 'Таблица турнира (материализована)';

COMMENT ON COLUMN "tournament_standings"."prev_rank" IS 'стрелка ↑↓';

COMMENT ON COLUMN "tournament_standings"."tiebreak" IS 'платные трансферы, очки последней стадии, время';

COMMENT ON COLUMN "tournament_standings"."is_final" IS 'места окончательные после разбора всех карт';

COMMENT ON TABLE "mini_leagues" IS 'Мини-лига';

COMMENT ON COLUMN "mini_leagues"."code" IS 'SLM9-K7QX';

COMMENT ON COLUMN "mini_leagues"."scope" IS 'tournament | season';

COMMENT ON TABLE "mini_league_members" IS 'Участник мини-лиги';

COMMENT ON TABLE "pickem_questions" IS 'Вопрос';

COMMENT ON COLUMN "pickem_questions"."series_id" IS 'для вопросов «кто выиграет серию»';

COMMENT ON COLUMN "pickem_questions"."kind" IS 'series | two_of | one_of';

COMMENT ON COLUMN "pickem_questions"."options" IS 'team_id вариантов';

COMMENT ON COLUMN "pickem_questions"."closes_at" IS 'дедлайн стадии или старт серии';

COMMENT ON COLUMN "pickem_questions"."correct" IS 'заполняется после итога';

COMMENT ON TABLE "pickem_answers" IS 'Ответ менеджера';

COMMENT ON COLUMN "pickem_answers"."answer" IS '{w, sc} | {set} | {w}';

COMMENT ON COLUMN "pickem_answers"."points" IS 'после итога';

COMMENT ON TABLE "pickem_results" IS 'Итог прогнозов за турнир';

COMMENT ON COLUMN "pickem_results"."medal" IS 'bronze | silver | gold | platinum';

COMMENT ON TABLE "league_tiers" IS 'Лиги (справочник)';

COMMENT ON COLUMN "league_tiers"."id" IS '1 Рекрут … 8 Титан';

COMMENT ON COLUMN "league_tiers"."code" IS 'herald…immortal';

COMMENT ON TABLE "season_ladders" IS 'Какие лиги активны в сезоне';

COMMENT ON COLUMN "season_ladders"."is_active" IS 'фазы 1–3 по аудитории';

COMMENT ON TABLE "league_memberships" IS 'Лига менеджера в сезоне';

COMMENT ON COLUMN "league_memberships"."tier_id" IS 'null — калибровка';

COMMENT ON TABLE "league_rounds" IS 'Раунд лиги = турнир';

COMMENT ON COLUMN "league_rounds"."status" IS 'upcoming | grouped | settled';

COMMENT ON TABLE "league_groups" IS 'Группа раунда';

COMMENT ON COLUMN "league_groups"."pooled_key" IS 'сводная таблица нескольких лиг';

COMMENT ON COLUMN "league_groups"."zone_up" IS 'мест в зоне повышения';

COMMENT ON TABLE "league_group_members" IS 'Менеджер в группе';

COMMENT ON COLUMN "league_group_members"."round_id" IS 'для UNIQUE';

COMMENT ON COLUMN "league_group_members"."zone" IS 'up | stay | down';

COMMENT ON TABLE "titan_round_points" IS 'Очки F1 Титанов за раунд';

COMMENT ON COLUMN "titan_round_points"."f1_points" IS '25, 18, 15…';

COMMENT ON TABLE "season_titles" IS 'Титулы сезона';

COMMENT ON COLUMN "season_titles"."title" IS 'best_regular | champion | best_tier';

COMMENT ON TABLE "achievements" IS 'Достижение (справочник)';

COMMENT ON COLUMN "achievements"."tiers" IS 'пороги уровней';

COMMENT ON TABLE "user_achievements" IS 'Полученное достижение';

COMMENT ON COLUMN "user_achievements"."context" IS 'турнир, игрок, карта';

COMMENT ON TABLE "trophies" IS 'Трофей';

COMMENT ON COLUMN "trophies"."kind" IS 'promotion | group_first | best_stage | pickem_medal';

COMMENT ON TABLE "notifications" IS 'Уведомление';

COMMENT ON COLUMN "notifications"."channel" IS 'telegram | email | push | inapp';

COMMENT ON TABLE "tenants" IS 'Тенант (бренд)';

COMMENT ON COLUMN "tenants"."slug" IS 'default, partner-x';

COMMENT ON COLUMN "tenants"."branding" IS 'цвета, шрифты, домен';

COMMENT ON TABLE "api_clients" IS 'Ключ API партнёра';

COMMENT ON COLUMN "api_clients"."scopes" IS 'read:tournaments, read:standings…';

COMMENT ON TABLE "webhook_subscriptions" IS 'Подписка на события';

COMMENT ON COLUMN "webhook_subscriptions"."events" IS 'map.scored, stage.locked, stage.settled';

COMMENT ON COLUMN "webhook_subscriptions"."secret_hash" IS 'подпись запросов';

COMMENT ON TABLE "webhook_deliveries" IS 'Доставка вебхука';

COMMENT ON COLUMN "webhook_deliveries"."status" IS 'pending | delivered | failed';

ALTER TABLE "team_rosters" ADD FOREIGN KEY ("team_id") REFERENCES "teams" ("id");

ALTER TABLE "team_rosters" ADD FOREIGN KEY ("player_id") REFERENCES "players" ("id");

ALTER TABLE "tournaments" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "tournaments" ADD FOREIGN KEY ("organizer_id") REFERENCES "organizers" ("id");

ALTER TABLE "tournaments" ADD FOREIGN KEY ("scoring_ruleset_id") REFERENCES "scoring_rulesets" ("id");

ALTER TABLE "stages" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "stage_groups" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "tournament_teams" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "tournament_teams" ADD FOREIGN KEY ("team_id") REFERENCES "teams" ("id");

ALTER TABLE "tournament_teams" ADD FOREIGN KEY ("group_id") REFERENCES "stage_groups" ("id");

ALTER TABLE "tournament_teams" ADD FOREIGN KEY ("eliminated_after_stage_id") REFERENCES "stages" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("group_id") REFERENCES "stage_groups" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("team_a_id") REFERENCES "teams" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("team_b_id") REFERENCES "teams" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("winner_team_id") REFERENCES "teams" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("next_win_series_id") REFERENCES "series" ("id");

ALTER TABLE "series" ADD FOREIGN KEY ("next_lose_series_id") REFERENCES "series" ("id");

ALTER TABLE "streams" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "streams" ADD FOREIGN KEY ("series_id") REFERENCES "series" ("id");

ALTER TABLE "maps" ADD FOREIGN KEY ("series_id") REFERENCES "series" ("id");

ALTER TABLE "maps" ADD FOREIGN KEY ("radiant_team_id") REFERENCES "teams" ("id");

ALTER TABLE "maps" ADD FOREIGN KEY ("dire_team_id") REFERENCES "teams" ("id");

ALTER TABLE "maps" ADD FOREIGN KEY ("winner_team_id") REFERENCES "teams" ("id");

ALTER TABLE "map_draft" ADD FOREIGN KEY ("map_id") REFERENCES "maps" ("id");

ALTER TABLE "map_draft" ADD FOREIGN KEY ("team_id") REFERENCES "teams" ("id");

ALTER TABLE "map_draft" ADD FOREIGN KEY ("hero_id") REFERENCES "heroes" ("id");

ALTER TABLE "player_map_stats" ADD FOREIGN KEY ("map_id") REFERENCES "maps" ("id");

ALTER TABLE "player_map_stats" ADD FOREIGN KEY ("player_id") REFERENCES "players" ("id");

ALTER TABLE "player_map_stats" ADD FOREIGN KEY ("team_id") REFERENCES "teams" ("id");

ALTER TABLE "player_map_stats" ADD FOREIGN KEY ("hero_id") REFERENCES "heroes" ("id");

ALTER TABLE "data_overrides" ADD FOREIGN KEY ("created_by") REFERENCES "users" ("id");

ALTER TABLE "tournament_players" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "tournament_players" ADD FOREIGN KEY ("player_id") REFERENCES "players" ("id");

ALTER TABLE "tournament_players" ADD FOREIGN KEY ("team_id") REFERENCES "teams" ("id");

ALTER TABLE "player_prices" ADD FOREIGN KEY ("tournament_player_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "player_prices" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "player_map_points" ADD FOREIGN KEY ("map_id") REFERENCES "maps" ("id");

ALTER TABLE "player_map_points" ADD FOREIGN KEY ("tournament_player_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "player_map_points" ADD FOREIGN KEY ("ruleset_id") REFERENCES "scoring_rulesets" ("id");

ALTER TABLE "player_stage_points" ADD FOREIGN KEY ("tournament_player_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "player_stage_points" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "users" ADD FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id");

ALTER TABLE "users" ADD FOREIGN KEY ("favorite_team_id") REFERENCES "teams" ("id");

ALTER TABLE "auth_identities" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "user_sessions" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "notification_prefs" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "lineups" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "lineups" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "lineups" ADD FOREIGN KEY ("triple_used_stage_id") REFERENCES "stages" ("id");

ALTER TABLE "lineups" ADD FOREIGN KEY ("wildcard_used_stage_id") REFERENCES "stages" ("id");

ALTER TABLE "lineup_slots" ADD FOREIGN KEY ("lineup_id") REFERENCES "lineups" ("id");

ALTER TABLE "lineup_slots" ADD FOREIGN KEY ("tournament_player_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "lineup_locks" ADD FOREIGN KEY ("lineup_id") REFERENCES "lineups" ("id");

ALTER TABLE "lineup_locks" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "lineup_locks" ADD FOREIGN KEY ("captain_tp_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "lineup_lock_slots" ADD FOREIGN KEY ("lock_id") REFERENCES "lineup_locks" ("id");

ALTER TABLE "lineup_lock_slots" ADD FOREIGN KEY ("tournament_player_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "transfers" ADD FOREIGN KEY ("lineup_id") REFERENCES "lineups" ("id");

ALTER TABLE "transfers" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "transfers" ADD FOREIGN KEY ("out_tp_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "transfers" ADD FOREIGN KEY ("in_tp_id") REFERENCES "tournament_players" ("id");

ALTER TABLE "lineup_stage_scores" ADD FOREIGN KEY ("lineup_id") REFERENCES "lineups" ("id");

ALTER TABLE "lineup_stage_scores" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "tournament_standings" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "tournament_standings" ADD FOREIGN KEY ("lineup_id") REFERENCES "lineups" ("id");

ALTER TABLE "mini_leagues" ADD FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id");

ALTER TABLE "mini_leagues" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "mini_leagues" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "mini_league_members" ADD FOREIGN KEY ("mini_league_id") REFERENCES "mini_leagues" ("id");

ALTER TABLE "mini_league_members" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "pickem_questions" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "pickem_questions" ADD FOREIGN KEY ("stage_id") REFERENCES "stages" ("id");

ALTER TABLE "pickem_questions" ADD FOREIGN KEY ("series_id") REFERENCES "series" ("id");

ALTER TABLE "pickem_answers" ADD FOREIGN KEY ("question_id") REFERENCES "pickem_questions" ("id");

ALTER TABLE "pickem_answers" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "pickem_results" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "pickem_results" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "season_ladders" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "season_ladders" ADD FOREIGN KEY ("tier_id") REFERENCES "league_tiers" ("id");

ALTER TABLE "league_memberships" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "league_memberships" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "league_memberships" ADD FOREIGN KEY ("tier_id") REFERENCES "league_tiers" ("id");

ALTER TABLE "league_memberships" ADD FOREIGN KEY ("best_tier_id") REFERENCES "league_tiers" ("id");

ALTER TABLE "league_rounds" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "league_rounds" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "league_groups" ADD FOREIGN KEY ("round_id") REFERENCES "league_rounds" ("id");

ALTER TABLE "league_groups" ADD FOREIGN KEY ("tier_id") REFERENCES "league_tiers" ("id");

ALTER TABLE "league_group_members" ADD FOREIGN KEY ("group_id") REFERENCES "league_groups" ("id");

ALTER TABLE "league_group_members" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "league_group_members" ADD FOREIGN KEY ("round_id") REFERENCES "league_rounds" ("id");

ALTER TABLE "league_group_members" ADD FOREIGN KEY ("lineup_id") REFERENCES "lineups" ("id");

ALTER TABLE "league_group_members" ADD FOREIGN KEY ("tier_at_start") REFERENCES "league_tiers" ("id");

ALTER TABLE "league_group_members" ADD FOREIGN KEY ("tier_after") REFERENCES "league_tiers" ("id");

ALTER TABLE "titan_round_points" ADD FOREIGN KEY ("round_id") REFERENCES "league_rounds" ("id");

ALTER TABLE "titan_round_points" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "titan_round_points" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "season_titles" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "season_titles" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "season_titles" ADD FOREIGN KEY ("tier_id") REFERENCES "league_tiers" ("id");

ALTER TABLE "user_achievements" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "user_achievements" ADD FOREIGN KEY ("achievement_id") REFERENCES "achievements" ("id");

ALTER TABLE "trophies" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "trophies" ADD FOREIGN KEY ("tournament_id") REFERENCES "tournaments" ("id");

ALTER TABLE "trophies" ADD FOREIGN KEY ("season_id") REFERENCES "seasons" ("id");

ALTER TABLE "notifications" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id");

ALTER TABLE "api_clients" ADD FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id");

ALTER TABLE "webhook_subscriptions" ADD FOREIGN KEY ("api_client_id") REFERENCES "api_clients" ("id");

ALTER TABLE "webhook_deliveries" ADD FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscriptions" ("id");
