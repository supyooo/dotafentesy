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
-- журнал событий (с 23.10.2026): посещения, вход, выбор, фиксации, прогнозы — для статистики; без личных данных и IP
create table if not exists events (
  id integer primary key autoincrement,
  at integer not null,           -- мс
  uid text,                      -- игрок после входа (как в states), иначе null
  vid text,                      -- случайный номер браузера (до входа тоже), ключ dfv в localStorage
  type text not null,            -- visit, view, gate, auth, pick, drop, captain, lock, swap, pk, pk_lock …
  tour text,
  data text                      -- JSON подробностей
);
create index if not exists events_at on events (at);
create index if not exists events_type_at on events (type, at);
create index if not exists events_uid on events (uid, at);
-- игра на сервере (с 24.10.2026, apps/site-api/src/game.ts): источник правды для таблицы и призов
create table if not exists lineups (
  uid text not null, tour text not null, stage integer not null,
  lineup_lock text not null,     -- состав при фиксации {carry..hard: account_id}
  lineup text not null,          -- текущий (после замен стендинов)
  captain_lock integer, captain integer,
  tc integer not null default 0, -- тройной капитан на эту стадию
  penalty real not null default 0,  -- штраф за трансферы к прошлой стадии
  locked_at integer not null, late integer not null default 0,  -- фиксация после старта стадии (тестовое правило)
  primary key (uid, tour, stage)
);
create table if not exists lineup_changes (
  id integer primary key autoincrement, uid text not null, tour text not null, stage integer not null,
  role text not null, out_acc integer not null, in_acc integer not null, at integer not null
);
create index if not exists lineup_changes_u on lineup_changes (uid, tour, stage);
create table if not exists predictions (
  uid text not null, tour text not null, key text not null,   -- key — узел сетки регламента (G8, UBQF1 …)
  w text not null, sc text, a text, b text, at integer not null,
  primary key (uid, tour, key)
);
create table if not exists pred_locks (uid text not null, tour text not null, stage integer not null, at integer not null, primary key (uid, tour, stage));
