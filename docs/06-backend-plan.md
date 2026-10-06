# 06. План бэкенда

> **Обновлено 3 октября:** стек — см. `08-stack.md` (TypeScript/NestJS вместо Rails), модель данных — см. `09-database.md` (заменяет черновик ниже). Порядок задач и критерии приёмки остаются в силе; в B2 первым шагом — спайк live-источника из `08-stack.md`.

Дедлайн, от которого считаем: **первая карта BLAST Slam IX — 20 ноября 2026**. До неё нужны: данные игроков и цены,
сохранение составов с правилами окон, сбор очков с OpenDota, таблица турнира. Сезон, лиги и прогнозы — следом, их можно включить ко второму раунду.
Полигон для проверки пайплайна — BLAST Slam VIII (`leagueid=19102`), идёт до 11 октября.

## Стек (подтвердить в B0)
Rails 8 в режиме API, PostgreSQL, Solid Queue (джобы и кроны), RSpec. Фронт — статический прототип на Cloudflare Pages, ходит в API (CORS).
Хостинг API — не выбран (07).

## Модель данных (черновик)
```
seasons            id, name, starts_on, ends_on, ladder (jsonb: лиги текущей фазы), config (jsonb: зоны, размер группы…)
tournaments        id, season_id, slug, name, opendota_league_id, status, starts_at, ends_at,
                   is_league_round, skin, config (jsonb: budget 48, max_per_team 2, free_transfers 1, transfer_cost 4, carry_max 2, price_steps…)
stages             id, tournament_id, idx, name, deadline_at, status (upcoming|open|locked|settling|settled), format
teams              id, name, tag, opendota_team_id
tournament_teams   tournament_id, team_id, group_label, seed, eliminated_after_stage_id
players            id, nick, account_id UNIQUE, team_id
tournament_players id, tournament_id, player_id, team_id, role (1..5), rating, start_price, role_coef_snapshot
player_prices      tournament_player_id, stage_id, price          -- цена на начало стадии; цена выбывшего фиксируется
series             id, tournament_id, stage_id, round_label, team_a_id, team_b_id, best_of, score_a, score_b, status, starts_at
maps               id, series_id, opendota_match_id UNIQUE, winner_team_id, status (provisional|final|void), parsed_at, duration_s
player_map_stats   map_id, player_id, stats (jsonb из OpenDota), raw_points, points, scoring_version
users              id, nick, favorite_team_id, avatar_hue, created_at   (+ способ входа — 07)
lineups            id, user_id, tournament_id, bank, free_transfers, chips_used (jsonb), first_completed_at
lineup_slots       lineup_id, role, tournament_player_id             -- текущий черновик в окне
lineup_snapshots   lineup_id, stage_id, slots (jsonb), captain_id, chip, transfers_paid, penalty, locked_at   -- заморожен в дедлайн
lineup_stage_scores lineup_id, stage_id, points                       -- материализовано, пересчитывается
mini_leagues       id, code UNIQUE, name, owner_id, scope (tournament|season)
mini_league_members mini_league_id, user_id
pickem_questions   id, tournament_id, stage_id, kind (series|two_of|one_of), payload (jsonb), max_points, closes_at, result (jsonb)
pickem_answers     question_id, user_id, answer (jsonb), points
pickem_results     tournament_id, user_id, points, max_points, medal
league_memberships season_id, user_id, league, skip_streak, best_league, calibrated_at
league_groups      id, season_id, tournament_id, league, number, pooled_with (nullable)
league_group_members group_id, user_id, place, outcome (up|stay|down)
titan_standings    season_id, user_id, f1_points, places (jsonb)
```
Ключевые инварианты:
- Трансферы = разница `lineup_slots` с `lineup_snapshots` прошлой стадии (или со стартом окна 0). Не лог действий. Отмена в UI — клиентская.
- Бесплатная замена выбывшего и гарантированная замена определяются по состоянию на момент сохранения, не по истории.
- Пересчёт любой карты → пересчёт `player_map_stats.points` → `lineup_stage_scores` → таблиц. Идемпотентно, по `scoring_version`.

## Джобы
| Джоба | Когда | Что делает |
|---|---|---|
| `IngestLeagueMatchesJob` | каждые 2 мин во время турнира | `/leagues/{id}/matches` → новые карты; привязка к серии и стадии; `/request/{id}` если нет разбора |
| `RefreshMapJob(map)` | после ingest, повтор до 30 мин | `/matches/{id}`; статус provisional → final; ремейки → void |
| `ScoreMapJob(map)` | после Refresh | очки по таблице 02 §5 и множителям турнира; обновляет суммы |
| `LockStageJob(stage)` | в `deadline_at` | снимок всех составов, применение чипов, штрафов; закрытие вопросов прогнозов |
| `SettleStageJob(stage)` | когда все карты стадии final | выбывшие, новые цены, открытие окна, ответы на вопросы прогнозов, новые вопросы |
| `SettleTournamentJob` | после финала | итог, равенства, медали прогнозов, раунд лиги (группы → места → переезды), Титаны F1 |
| `FormLeagueGroupsJob` | дедлайн первой стадии раунда | группы по лигам по правилам 03 §3 |
| `NotifyJob` | по событиям | 3 уведомления из 03 §8 |

## API (JSON, черновик)
```
GET  /api/tournaments                         список: идёт / скоро / прошли
GET  /api/tournaments/:slug                   конфиг, стадии, команды, статус, трансляции
GET  /api/tournaments/:slug/players           рынок: цена, изменение, прогноз изменения, форма, доля владения, соперник
GET  /api/tournaments/:slug/lineup            мой состав, банк, бесплатные трансферы, штраф, чипы, что заморожено
PUT  /api/tournaments/:slug/lineup            сохранить целиком {slots, captain, chip}; сервер валидирует и считает трансферы
GET  /api/tournaments/:slug/series?stage=     серии, карты, статистика игроков, статус карт
GET  /api/tournaments/:slug/standings?page=&filter=   таблица турнира + моя строка
GET  /api/tournaments/:slug/picks             вопросы стадий, мои ответы, итоги, баллы, медаль
PUT  /api/tournaments/:slug/picks             ответы открытой стадии
GET  /api/seasons/current/group               моя группа: 30 строк, зоны, мой зазор
GET  /api/seasons/current/ladder              лиги и число игроков
GET  /api/me                                  профиль, история турниров, медали, трофеи
POST /api/mini_leagues, POST /api/mini_leagues/join, GET /api/mini_leagues/:code
```
Ошибки валидации состава — с машинным кодом и русским текстом (как `reason()` в прототипе: «Не хватает денег в банке», «Не больше 2 игроков одной команды», «Команда выбыла»).

## Задачи по порядку
Каждая — отдельный PR. Критерии приёмки — минимум; тесты на правила обязательны.

**B0. Решения и скаффолд.** Подтвердить стек и хостинг; `rails new --api`, Postgres, Solid Queue, RSpec, CI, `.env.example`.
Готово, когда: `bin/setup && bin/rails s` поднимает `/up`; CI зелёный.

**B1. Справочники.** Модели teams, players, tournaments, stages, tournament_teams, tournament_players; сид Slam VIII и Slam IX из прототипа
(16 команд × 5, позиции). account_id — через `/proPlayers` по нику + команде, неуверенные совпадения — в отчёт, не угадывать.
Готово, когда: rake-задача печатает 80 игроков с account_id и список несопоставленных.

**B2. Сбор и скоринг.** Перенести логику `scripts/slam_live.py` в джобы; скоринг по таблице 02 §5 (не по прототипу!); статусы карт, ремейки, стендины.
Прогнать на Slam VIII. Готово, когда: все карты Slam VIII в базе, повторный прогон ничего не меняет, есть отчёт «средние сырые очки за карту по ролям»
и предложенные множители (цель — 10 оч/карту), доля очков саппорта от вардов и оглушений.

**B3. Цены.** Стартовые цены из `scripts/slam_ratings.py` (перенести или вызвать), изменение после стадии по 02 §6, история цен.
Готово, когда: для Slam IX есть 80 цен 4.5–12.5; проверка «пятёрка сильнейших по позициям не влезает в 48»; тест на шкалу изменений.

**B4. Состав.** `GET/PUT lineup` со всеми правилами 02 §1, §3, §4: окна, разница с базой окна, перенос бесплатного, штраф, бесплатная замена выбывших,
гарантированная замена, лимит 3 при 2 командах, чипы. Временная авторизация — токен устройства (до B8).
Готово, когда: таблица тест-кейсов на каждое правило; «продал двух, купил одного, отменил» = 0 трансферов.

**B5. Жизненный цикл стадии и таблица.** `LockStageJob`, `SettleStageJob`, `lineup_stage_scores`, standings с равенствами.
Режим ручного управления для тестов (аналог кнопки «Сыграть стадию»). Готово, когда: Slam VIII прогоняется от окна 0 до итога на тестовых составах.

**B6. Фронт на API.** В прототипе — слой данных: если задан `API_BASE`, данные из API, иначе текущая симуляция (демо-режим для питча).
Начать с рынка, состава, матчей и таблицы турнира. Готово, когда: прототип на Pages показывает реальные карты Slam VIII.

**B7. Прогнозы.** Вопросы, закрытие в дедлайн, автоответы по результатам серий, медали по 04. Пороги — в конфиге.

**B8. Пользователи и вход.** Способ входа — решение Georgy (07). Перенос состава с токена устройства на аккаунт.

**B9. Сезон и лиги.** После подтверждения вердиктов 4, 5, 7 (03 §9). Калибровка, группы, зоны по Excel-модели, Титаны.

**B10. Мини-лиги.** Код/ссылка, таблица турнира и сезона.

**B11. Уведомления.** Три события из 03 §8; канал — решение Georgy (Telegram-бот выглядит естественно: у него уже есть опыт с ботами).

## Задачи на фронт (параллельно, не блокируют бэкенд)
- **F1.** Удалить мёртвый код Лобби (`advanceDraft`, `L()`, `freshLobby`, `renderLobby`, разметку `lobby`, стили `lb-*`, требование `S.lobby` в `loadS` — с миграцией сохранённого состояния).
- **F2.** Привести формулы к спеке: таблица очков, цены, без публичного рейтинга, бесплатная замена выбывших, гарантированная замена (кнопка в плашке «не хватает»), перенос трансфера, Вайлдкард, лимит 3.
- **F3.** Подключить заставки из `prototype/intro/` по README там же.
- **F4.** Рейтинг сезона на телефоне: по умолчанию окно вокруг себя и границы зон, «вся группа» — кнопкой (как блок на главной).
- **F5.** Таблица прогнозов турнира — если Georgy решит, что нужна.
