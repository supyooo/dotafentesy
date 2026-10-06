# Спайк live-источника (docs/08-stack.md, «Первая задача»)

Отдельные скрипты на TypeScript, без каркаса приложения. Полигон — BLAST Slam VIII (`league_id=19102`, до 11.10.2026).
Результат — `REPORT.md`. Сырые ответы и логи — в `data/` (в .gitignore).

```bash
cd spikes/live-source && npm install
npx tsx src/final.ts            # итог сыгранных карт из OpenDota → data/final.json (очки по спеке на уровнях live/basic/parsed)
npx tsx src/final.ts --request  # + заказать разбор реплея для неразобранных карт
npx tsx src/live.ts             # опрос Steam GetLiveLeagueGames каждые 7 с → data/live/*.jsonl (нужен ключ)
npx tsx src/report.ts           # → REPORT.md
```

- Ключ Steam Web API: https://steamcommunity.com/dev/apikey → файл `spikes/live-source/.env` со строкой `STEAM_API_KEY=…`
  (файл в .gitignore; в логах ключ маскируется).
- Сопоставление игроков — по account_id из `prototype/data/players.json`, позиции — из `rosters.json`.
- Скоринг — `src/scoring.ts`, строго по таблице docs/02 §5 (без GPM, вышек, Рошана, первой крови).
- Лимит OpenDota без ключа ~60 запросов/мин: разобранные карты берутся из кэша `data/raw/match/`, неразобранные перезапрашиваются.
