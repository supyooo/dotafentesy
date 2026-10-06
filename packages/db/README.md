# @df/db

Drizzle-схема по `docs/09-database.md` (без мини-лиг — решение 06.10.2026).

- `src/schema/<домен>.ts` — первая версия сгенерирована `scripts/gen_drizzle.py` из `docs/db/schema.py` (из него же собран DBML);
  дальше правится руками. Перегенерация затирает файлы — смотреть diff.
- Сверх DDL-эталона: identity у `id`, CHECK для перечислений (`a | b | c` в комментарии) и диапазонов (`1–5`),
  `series (status) WHERE status='live'`, `users UNIQUE (tenant_id, lower(nickname))`, `notifications (user_id, created_at DESC)`,
  `DEFAULT now()` у служебных времён.
- `raw_payloads` — ручная миграция `0001_raw_payloads_partitioned.sql` (партиции по месяцам, PK `(id, fetched_at)`,
  функция `raw_payloads_ensure_partition(date)`); описание для запросов — `src/schema-manual/`, drizzle-kit его не видит.
- Сверка с `docs/db/schema.sql` (06.10.2026): колонки, типы, NULL и FK совпадают; индексы отличаются только тремя дополнительными выше.

Команды (из корня): `pnpm db:migrate`, `pnpm db:seed`; новая миграция — `pnpm --filter @df/db generate`.
Сиды: справочники, сезон 2026/27, правила `2026.10-spec` и `2026.10-b`, команды/игроки/составы из `prototype/data`,
турниры Slam VIII (league 19102) и Slam IX (20208) с пулами. Временное — в `tournaments.config.provisional`.
