# 11. Структура бэкенда — предложение (на согласование)

Под стек из `08-stack.md` и схему `09-database.md`. Принято 06.10.2026 («сам всё установи»): B0 сделан — `apps/api`, `packages/domain`, `packages/db`; `apps/worker`, `contracts`, `sources` — по мере задач. Docker нет (нужны права администратора и перезагрузка для WSL) — Postgres портативный, Redis отложен.

## Монорепозиторий
pnpm workspaces + Turborepo (кэш сборок и тестов, один `pnpm test` на всё).
```
apps/
  api/            NestJS (Fastify): HTTP API + SSE. Модули = домены 09: catalog, tournaments, scoring, lineups,
                  standings, pickem, season, users (auth), live (SSE), admin (ручное управление стадиями, data_overrides)
  worker/         тот же Nest, но NestFactory.createApplicationContext — только процессоры BullMQ:
                  ingest-opendota, ingest-steam-live, ingest-liquipedia, score-map, lock-stage, settle-stage,
                  standings, notify. Отдельный процесс: падение сборщика не роняет API, масштабируются раздельно
packages/
  domain/         чистые правила без IO: скоринг (02 §5), валидация состава и трансферы (02 §1–4), цены (02 §6),
                  баллы прогнозов (04), зоны лиг (03). 100% unit-тесты (vitest) — здесь живут таблицы тест-кейсов из 06
  db/             Drizzle: схема по доменам, миграции, сиды (из prototype/data/*.json), запросы пересчётов (set-based SQL)
  contracts/      zod-схемы запросов/ответов → OpenAPI и типы для фронта
  sources/        адаптеры OpenDota / Steam / Liquipedia / STRATZ → нормализованные типы + запись raw_payloads, external_refs
spikes/           одноразовые проверки (live-source)
prototype/        текущий фронт (Pages), позже переходит на API по B6
```
Правило зависимостей: `domain` ни от чего не зависит; `db` и `sources` — от `domain`; `apps` — от всего. Проверяется eslint-правилом границ.

## Миграции Drizzle
- Схема — TypeScript в `packages/db/src/schema/<домен>.ts` (11 файлов по разделам 09). Источник правды — по-прежнему `docs/db/schema.dbml`:
  первая версия Drizzle-схемы генерируется из DBML скриптом (как `docs/db/gen.py` делает DDL), дальше правится руками.
- `drizzle-kit generate` → SQL-миграции в `packages/db/migrations/` (коммитятся, ревьюятся как обычный SQL).
- Что Drizzle сам не умеет — отдельные ручные миграции: партиционирование `raw_payloads` по месяцам, `CHECK` для перечислений
  (text + CHECK, как требует 09), identity-колонки, частичные индексы (`WHERE status='live'`), `UNIQUE (tenant_id, lower(nickname))`.
- Сверка с эталоном: в CI поднимаем Postgres 17, накатываем миграции и сравниваем со `schema.sql` (pg_dump --schema-only + diff), чтобы схема не уехала от DBML.
- Сиды: справочники (league_tiers, heroes из OpenDota `/heroes`), команды/игроки/пул Slam VIII и Slam IX из `prototype/data/*.json`, scoring_rulesets `2026.10-spec` (02 §5 как есть) и `2026.10-b` (калибровка Slam VIII, черновик — см. 07).

## Порядок (переложение 06 на новый стек)
B0 — монорепо, CI, `/health` (сделано 06.10). B1 — схема, миграции, сиды (сделано 06.10, см. packages/db/README.md). B2 — сбор OpenDota + скоринг (логика спайка → `domain` + `worker`),
прогон Slam VIII — сделано 06.10: `packages/sources` (OpenDota), `apps/worker` (джобы ingest-opendota и score пока как функции + CLI,
без Nest и BullMQ — Redis нет). Результат совпадает со спайком до сотых; повторный сбор — 0 изменений, одинаковые сырые ответы не пишутся.
Находка: у части карт OpenDota нет series_id (2 из 60) — серия склеивается по паре команд и интервалу 4 ч.
Slam VIII в базе одной стадией «стадии не размечены»: стадии и сетку даст Liquipedia или админка. Дальше по 06 без изменений.
