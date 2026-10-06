# Dota Fantasy

Фан-фэнтези по тир-1 Dota 2. Контекст, правила работы и карта репозитория — в `CLAUDE.md`, спецификации — в `docs/`.

- Прототип: `python scripts/serve.py` → http://localhost:8000 (через сервер: данные грузятся из `prototype/data/`) или https://dota-fantasy.pages.dev/.
  Кнопка «Сыграть стадию» — в меню, блок «ТЕСТ».
- Деплой на Pages: `npx wrangler pages deploy prototype --project-name dota-fantasy --branch main`.
- Данные: после правки `prototype/data/*.json` — `python scripts/validate_data.py`.
- Спайк данных Slam VIII: `cd spikes/live-source && npm install && npx tsx src/final.ts && npx tsx src/report.ts` → `REPORT.md`
  (скоринг по спеке 02 §5; live-часть — `npx tsx src/live.ts`, нужен ключ Steam в `spikes/live-source/.env`).
- Старый сборщик `scripts/slam_live.py` — скоринг в нём устаревший (docs/05, расхождение №1).
- Бэкенд (монорепо pnpm + Turborepo, docs/11): `pnpm install && pnpm build && pnpm test`; API — `pnpm dev:api` → http://localhost:3000/health.
  Нужен Postgres 17 и `.env` (шаблон `.env.example`). Локально стоит портативный Postgres в `%LOCALAPPDATA%\df-tools`:
  `"%LOCALAPPDATA%\df-tools\pgsqlin\pg_ctl" -D "%LOCALAPPDATA%\df-tools\pgdata" -l "%LOCALAPPDATA%\df-tools\pg.log" start`. Redis пока нет.
- Модель лиг: `models/dota-fantasy-ligi-model.xlsx`, меняются только жёлтые ячейки на листе «Ввод».

## Текущая задача для Claude Code
B0 и B1 сделаны: каркас (`apps/api` с `/health`, `packages/domain` — скоринг и цены с тестами), схема Drizzle по `docs/09`
без мини-лиг (54 таблицы), миграции и сиды (`pnpm db:migrate && pnpm db:seed`). Redis отложен.
B2 сделан без очередей: `pnpm --filter @df/worker cli ingest blast-slam-8` (OpenDota → серии, карты, статистика, драфт, raw_payloads),
`… cli score blast-slam-8 --rulesets 2026.10-spec,2026.10-b` (очки по версиям правил + очки за стадию), `… cli report blast-slam-8`.
Дальше — B3+ по docs/06 (составы, трансферы, цены, прогнозы) и API для прототипа; BullMQ — когда будет Redis. Спайк Slam VIII: live ждёт ключ Steam;
скоринг `2026.10-b` — черновик на решение (docs/07). Хостинг — решает Georgy.
