-- База сайта (Cloudflare D1 «dota-fantasy», привязка DB в wrangler.toml): прогресс игроков и их текущие составы.
-- Личных данных нет: uid — HMAC от Telegram id с секретом сервера (functions/api/[[path]].ts).
--   npx wrangler d1 execute dota-fantasy --remote --file apps/site-api/schema.sql
create table if not exists states (
  uid text primary key,          -- обезличенный id игрока
  data text not null,            -- прогресс: ключи df-* из localStorage (составы, прогнозы, кабинет), JSON
  updated integer not null       -- мс, время последнего сохранения
);
create table if not exists picks (
  uid text not null,
  tour text not null,            -- id турнира прототипа (pari, blast …)
  acc integer not null,          -- account_id игрока в текущем составе
  primary key (uid, tour, acc)
);
create index if not exists picks_tour on picks (tour, acc);
