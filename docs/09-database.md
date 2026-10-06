# 09. База данных — ER-модель

Источник правды схемы — `docs/db/schema.dbml` (открывается на dbdiagram.io). `docs/db/schema.sql` — DDL, сгенерирован из DBML и проверен на PostgreSQL 16 (56 таблиц, 110 FK).
В коде схема живёт в Drizzle; DDL — эталон для сверки. В DDL нет партиционирования, CHECK для перечислений и identity — добавить в миграциях.

## Принципы
- **Статистика отдельно от очков.** `player_map_stats` хранит сырые цифры карты, `player_map_points` — очки по конкретной версии правил. Поменяли таблицу очков — пересчитали очки, статистику не трогаем и в API не ходим.
- **Правила очков версионируются.** `scoring_rulesets`: турнир ссылается на версию правил. Калибровка после Slam VIII — новая версия, старые турниры не меняются.
- **Сырые ответы источников храним.** `raw_payloads` по месяцам. Нашли ошибку в разборе — перепроигрываем из базы. Live-ответы сэмплируем (не чаще раза в минуту на карту) и держим 30 дней, иначе таблица вырастет на гигабайты за турнир.
- **Один игрок — много внешних ID.** `external_refs` связывает наши записи с Liquipedia, OpenDota, STRATZ, Steam, GRID. Новый источник = новые строки, а не новые колонки.
- **Уровень достоверности у каждой цифры.** `data_tier` = live / basic (конец карты) / parsed (после разбора) на картах, статистике, очках и счёте стадии. На этом держится интерфейс «live · без вардов» и пересчёты.
- **Пул турнира отдельно от игрока.** `tournament_players`: позиция, цена, команда — на конкретный турнир. Решафл или стендин не ломают историю.
- **Черновик и снимки состава.** `lineup_slots` — то, что менеджер правит в окне (с отменой). В дедлайн создаётся `lineup_locks` + `lineup_lock_slots`, трансферы считаются разницей двух снимков и пишутся в `transfers`.
- **Сетка — граф серий.** `series.next_win_series_id / next_lose_series_id` описывают любой формат: GSL, швейцарку, double elimination. Liquipedia даёт сетку — мы её раскладываем в узлы.
- **Таблицы материализованы.** `tournament_standings`, `lineup_stage_scores`, `player_stage_points` пересчитываются пакетно одним SQL, а не считаются на каждый запрос.
- **Ручные правки — поверх, а не вместо.** `data_overrides`: стендин, ремейк, ошибка источника. Применяются при каждом пересчёте, у каждой есть причина и автор.
- **Тенант с первого дня.** `users.tenant_id`: свой сайт — тенант по умолчанию. Под B2B-партнёра заводится новый тенант со своими пользователями на общем каталоге турниров. Добавить колонку сейчас стоит ничего, потом — миграция всех пользовательских таблиц.
- **Перечисления — text + CHECK.** Статусы и виды хранятся текстом с ограничением. Новый статус — правка ограничения, а не ALTER TYPE с блокировками.

## Домены и таблицы

### 1. Каталог
Команды, игроки, составы во времени, герои и сопоставление с внешними источниками. Живёт дольше любого турнира.

**`teams`** — Команда _(~200)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| name | text | NN |  |
| tag | text | NN | TS, PARI… |
| country_code | char(2) |  |  |
| logo_url | text |  | свой файл, не логотип организатора |
| updated_at | timestamptz | NN |  |

**`players`** — Игрок про-сцены _(~1 000)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| nickname | text | NN | текущий ник; ники меняются — не ключ |
| real_name | text |  |  |
| country_code | char(2) |  |  |
| steam_account_id | bigint | UQ | account_id (Steam32) — главный ключ сопоставления |
| photo_url | text |  |  |
| photo_license | text |  | источник и права на фото |
| updated_at | timestamptz | NN |  |

**`team_rosters`** — Кто за какую команду играл и когда _(~3 000)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| team_id | bigint | →teams NN |  |
| player_id | bigint | →players NN |  |
| position | smallint |  | 1–5 |
| role | text | NN | player | standin | coach |
| valid_from | date | NN |  |
| valid_to | date |  | null — состав актуален |
- INDEX (player_id, valid_to)

**`heroes`** — Герои Dota _(~127)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | smallint | PK | hero_id из игры |
| code | text | NN | npc_dota_hero_… |
| name_ru | text | NN |  |
| icon_url | text |  |  |

**`external_refs`** — Сопоставление с внешними источниками _(десятки тысяч)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| entity_type | text | NN | team | player | tournament | series | map | league |
| entity_id | bigint | NN | id в нашей таблице |
| provider | text | NN | liquipedia | opendota | stratz | steam | pandascore | grid |
| external_id | text | NN |  |
| url | text |  |  |
- UNIQUE (provider, entity_type, external_id)
- INDEX (entity_type, entity_id)


### 2. Турнир и формат
Сезон, турнир, стадии, группы, сетка серий как граф, карты, драфт и статистика игроков на карте.

**`organizers`** — Организатор

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| name | text | NN | BLAST, PGL, ESL… |
| slug | text | UQ |  |

**`seasons`** — Сезон (от TI до TI)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| name | text | NN | 2026/27 |
| starts_on | date | NN |  |
| ends_on | date |  |  |
| status | text | NN | planned | active | finished |
| config | jsonb | NN | зоны, размер группы, калибровка, F1-очки |

**`tournaments`** — Турнир _(~15 в сезон)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| season_id | bigint | →seasons |  |
| organizer_id | bigint | →organizers |  |
| slug | text | UQ | blast-slam-9 |
| name | text | NN |  |
| tier | smallint | NN | 1 |
| prize_pool_usd | integer |  |  |
| location | text |  |  |
| starts_at | timestamptz |  |  |
| ends_at | timestamptz |  |  |
| status | text | NN | announced | open | live | finished | cancelled |
| is_league_round | boolean | NN | раунд лиги сезона |
| skin | text |  | оформление |
| scoring_ruleset_id | bigint | →scoring_rulesets NN | правила очков на турнир |
| config | jsonb | NN | бюджет, лимиты, трансферы, пороги медалей |

**`stages`** — Стадия (окно → дедлайн → игры)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tournament_id | bigint | →tournaments NN |  |
| idx | smallint | NN | 0, 1, 2… |
| name | text | NN |  |
| format | text | NN | gsl | swiss | round_robin | double_elim | single_elim |
| deadline_at | timestamptz |  | первая карта стадии |
| starts_at | timestamptz |  |  |
| ends_at | timestamptz |  |  |
| status | text | NN | upcoming | open | locked | settling | settled |
- UNIQUE (tournament_id, idx)

**`stage_groups`** — Группа внутри стадии

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| stage_id | bigint | →stages NN |  |
| label | text | NN | A, B… |

**`tournament_teams`** — Участник турнира

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| tournament_id | bigint | PK →tournaments |  |
| team_id | bigint | PK →teams |  |
| seed | smallint |  |  |
| group_id | bigint | →stage_groups |  |
| status | text | NN | active | eliminated |
| eliminated_after_stage_id | bigint | →stages |  |
| final_place | smallint |  |  |

**`series`** — Серия (узел сетки) _(~50 на турнир)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tournament_id | bigint | →tournaments NN |  |
| stage_id | bigint | →stages NN |  |
| group_id | bigint | →stage_groups |  |
| round_label | text | NN | «Верхняя сетка · 1/4» |
| bracket_side | text |  | group | upper | lower | final |
| round_no | smallint |  |  |
| slot | smallint |  | позиция в раунде |
| best_of | smallint | NN | 1 | 2 | 3 | 5 |
| team_a_id | bigint | →teams | null — ещё не определена |
| team_b_id | bigint | →teams |  |
| score_a | smallint | NN | 0 |
| score_b | smallint | NN | 0 |
| winner_team_id | bigint | →teams |  |
| status | text | NN | scheduled | live | finished | forfeit | cancelled |
| scheduled_at | timestamptz |  |  |
| started_at | timestamptz |  |  |
| finished_at | timestamptz |  |  |
| next_win_series_id | bigint | →series | куда идёт победитель |
| next_lose_series_id | bigint | →series | куда идёт проигравший |
- INDEX (tournament_id, stage_id)
- INDEX (status) WHERE status = 'live'

**`streams`** — Трансляции

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tournament_id | bigint | →tournaments NN |  |
| series_id | bigint | →series | null — канал турнира |
| platform | text | NN | twitch | youtube | vk | kick |
| url | text | NN |  |
| language | text |  | ru, en |

**`maps`** — Карта (одна игра серии) _(~150 на турнир)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| series_id | bigint | →series NN |  |
| map_no | smallint | NN | 1…5 |
| dota_match_id | bigint | UQ | match_id Valve; null до старта |
| radiant_team_id | bigint | →teams |  |
| dire_team_id | bigint | →teams |  |
| winner_team_id | bigint | →teams |  |
| duration_s | integer |  |  |
| started_at | timestamptz |  |  |
| ended_at | timestamptz |  |  |
| status | text | NN | live | finished | void (ремейк) |
| data_tier | text | NN | live | basic | parsed |
| parsed_at | timestamptz |  |  |
- UNIQUE (series_id, map_no)

**`map_draft`** — Пики и баны карты

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| map_id | bigint | PK →maps |  |
| order_no | smallint | PK |  |
| team_id | bigint | →teams NN |  |
| hero_id | smallint | →heroes NN |  |
| is_pick | boolean | NN |  |

**`player_map_stats`** — Статистика игрока на карте (сырая, без очков) _(~1 500 на турнир)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| map_id | bigint | PK →maps |  |
| player_id | bigint | PK →players |  |
| team_id | bigint | →teams NN |  |
| hero_id | smallint | →heroes |  |
| is_radiant | boolean | NN |  |
| won | boolean |  | null пока карта идёт |
| kills | smallint | NN | live |
| deaths | smallint | NN | live |
| assists | smallint | NN | live |
| last_hits | smallint | NN | live |
| denies | smallint | NN | live |
| gpm | smallint |  | live |
| xpm | smallint |  | live |
| net_worth | integer |  | live |
| hero_damage | integer |  | конец карты |
| building_damage | integer |  | конец карты |
| hero_healing | integer |  | конец карты |
| obs_placed | smallint |  | после разбора |
| obs_killed | smallint |  | после разбора |
| stun_s | numeric(6,1) |  | после разбора |
| camps_stacked | smallint |  | после разбора |
| data_tier | text | NN | live | basic | parsed |
| extra | jsonb |  | всё остальное из источника |
| updated_at | timestamptz | NN |  |
- INDEX (player_id)


### 3. Сбор данных
Сырые ответы внешних API, журнал запусков и ручные правки аналитика. Позволяет пересчитать всё без повторных запросов.

**`raw_payloads`** — Сырой ответ внешнего API _(самая большая таблица)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| provider | text | NN |  |
| resource | text | NN | league_matches | match | live_league_games | bracket… |
| external_id | text |  |  |
| fetched_at | timestamptz | NN | ключ партиции |
| http_status | smallint |  |  |
| payload | jsonb | NN |  |
| payload_hash | bytea | NN | дубликаты не пишем |
- PARTITION BY RANGE (fetched_at) — по месяцу
- UNIQUE (provider, resource, external_id, payload_hash, fetched_at)
- live-ответы: не чаще 1 раза в минуту на карту, хранить 30 дней

**`ingest_runs`** — Журнал запусков сборщиков

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| job | text | NN |  |
| provider | text | NN |  |
| started_at | timestamptz | NN |  |
| finished_at | timestamptz |  |  |
| status | text | NN | ok | partial | failed |
| items_seen | integer |  |  |
| items_changed | integer |  |  |
| error | text |  |  |

**`data_overrides`** — Ручные правки данных

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| entity_type | text | NN | map | player_map_stats | series | tournament_players… |
| entity_id | text | NN |  |
| field | text | NN |  |
| value | jsonb | NN |  |
| reason | text | NN | стендин, ремейк, ошибка источника |
| created_by | bigint | →users NN |  |
| created_at | timestamptz | NN |  |
- применяются поверх данных источника при каждом пересчёте


### 4. Фэнтези: очки и цены
Версии правил очков, пул игроков турнира с ценами и очки отдельно от статистики.

**`scoring_rulesets`** — Версия правил очков

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| version | text | UQ | 2026.10-a |
| rules | jsonb | NN | очки за статистики |
| role_coefs | jsonb | NN | множители позиций |
| published_at | timestamptz |  |  |
| notes | text |  |  |

**`tournament_players`** — Игрок в пуле турнира _(~80 на турнир)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tournament_id | bigint | →tournaments NN |  |
| player_id | bigint | →players NN |  |
| team_id | bigint | →teams NN |  |
| position | smallint | NN | 1–5, на турнир не меняется |
| is_active | boolean | NN | false — стендин заменил / снят |
| start_rating | numeric(5,2) |  | внутренний, не показываем |
| start_price | numeric(4,1) | NN | 4.5–12.5 |
- UNIQUE (tournament_id, player_id)

**`player_prices`** — Цена на начало стадии

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| tournament_player_id | bigint | PK →tournament_players |  |
| stage_id | bigint | PK →stages |  |
| price | numeric(4,1) | NN |  |
| change | numeric(3,1) | NN |  |
| reason | text |  | очки за карту / вылет (цена заморожена) |

**`player_map_points`** — Очки игрока за карту

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| map_id | bigint | PK →maps |  |
| tournament_player_id | bigint | PK →tournament_players |  |
| ruleset_id | bigint | PK →scoring_rulesets |  |
| raw_points | numeric(7,2) | NN |  |
| points | numeric(7,2) | NN | × множитель позиции |
| breakdown | jsonb | NN | очки по строкам — для «итога карты» |
| data_tier | text | NN | live | basic | parsed |
| computed_at | timestamptz | NN |  |

**`player_stage_points`** — Очки игрока за стадию (сумма)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| tournament_player_id | bigint | PK →tournament_players |  |
| stage_id | bigint | PK →stages |  |
| points | numeric(7,2) | NN |  |
| maps_played | smallint | NN |  |
| ownership_pct | numeric(5,2) |  | доля составов с игроком |


### 5. Пользователи
Аккаунт, способы входа, сессии, настройки уведомлений. Привязан к тенанту — задел под B2B.

**`users`** — Менеджер _(десятки тысяч)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tenant_id | bigint | →tenants NN | свой сайт = тенант по умолчанию |
| nickname | text | NN |  |
| avatar_hue | smallint |  |  |
| favorite_team_id | bigint | →teams |  |
| locale | text | NN | ru |
| role | text | NN | user | admin |
| created_at | timestamptz | NN |  |
| deleted_at | timestamptz |  | мягкое удаление |
- UNIQUE (tenant_id, lower(nickname))

**`auth_identities`** — Способ входа

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| user_id | bigint | →users NN |  |
| provider | text | NN | device | telegram | email | vk |
| provider_uid | text | NN |  |
| verified_at | timestamptz |  |  |
- UNIQUE (provider, provider_uid)

**`user_sessions`** — Сессия

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| user_id | bigint | →users NN |  |
| token_hash | bytea | UQ |  |
| created_at | timestamptz | NN |  |
| expires_at | timestamptz | NN |  |
| last_seen_at | timestamptz |  |  |

**`notification_prefs`** — Настройки уведомлений

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| user_id | bigint | PK →users |  |
| round_open | boolean | NN |  |
| deadline_reminder | boolean | NN | за 3 часа, если нет состава |
| round_result | boolean | NN |  |
| replay_parsed | boolean | NN | «разбор реплея готов» |
| channels | jsonb | NN | telegram, email, push |


### 6. Составы и таблица
Текущий черновик состава, замороженные снимки на каждую стадию, трансферы, очки и таблица турнира.

**`lineups`** — Состав менеджера на турнир _(= активных менеджеров × турниры)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| user_id | bigint | →users NN |  |
| tournament_id | bigint | →tournaments NN |  |
| bank | numeric(4,1) | NN |  |
| free_transfers | smallint | NN | 0–2 |
| captain_position | smallint |  | 1–5 |
| chip_pending | text | NN | none | triple | wildcard |
| triple_used_stage_id | bigint | →stages |  |
| wildcard_used_stage_id | bigint | →stages |  |
| first_completed_at | timestamptz |  | для равенства |
| total_points | numeric(8,2) | NN | денормализовано |
| updated_at | timestamptz | NN |  |
- UNIQUE (user_id, tournament_id)

**`lineup_slots`** — Текущий черновик (то, что видно в окне)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| lineup_id | bigint | PK →lineups |  |
| position | smallint | PK | 1–5 |
| tournament_player_id | bigint | →tournament_players NN |  |
| bought_price | numeric(4,1) | NN |  |

**`lineup_locks`** — Снимок состава в дедлайн стадии _(× стадии)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| lineup_id | bigint | →lineups NN |  |
| stage_id | bigint | →stages NN |  |
| captain_tp_id | bigint | →tournament_players NN |  |
| chip | text | NN | none | triple | wildcard |
| free_used | smallint | NN |  |
| paid_transfers | smallint | NN |  |
| penalty | numeric(5,1) | NN |  |
| locked_at | timestamptz | NN |  |
- UNIQUE (lineup_id, stage_id)

**`lineup_lock_slots`** — Игроки снимка _(самая большая пользовательская)_

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| lock_id | bigint | PK →lineup_locks |  |
| position | smallint | PK |  |
| tournament_player_id | bigint | →tournament_players NN |  |
| price_at_lock | numeric(4,1) | NN |  |
- INDEX (tournament_player_id) — кому начислять очки

**`transfers`** — Трансферы окна (фиксируются в дедлайн)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| lineup_id | bigint | →lineups NN |  |
| stage_id | bigint | →stages NN | стадия, перед которой окно |
| position | smallint | NN |  |
| out_tp_id | bigint | →tournament_players NN |  |
| in_tp_id | bigint | →tournament_players NN |  |
| out_price | numeric(4,1) | NN |  |
| in_price | numeric(4,1) | NN |  |
| kind | text | NN | free | paid | eliminated | guaranteed | wildcard |

**`lineup_stage_scores`** — Очки состава за стадию

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| lineup_id | bigint | PK →lineups |  |
| stage_id | bigint | PK →stages |  |
| points | numeric(8,2) | NN | с капитаном и штрафом |
| data_tier | text | NN | live | basic | parsed |
| updated_at | timestamptz | NN |  |

**`tournament_standings`** — Таблица турнира (материализована)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| tournament_id | bigint | PK →tournaments |  |
| lineup_id | bigint | PK →lineups |  |
| total_points | numeric(8,2) | NN |  |
| rank | integer | NN |  |
| prev_rank | integer |  | стрелка ↑↓ |
| tiebreak | jsonb | NN | платные трансферы, очки последней стадии, время |
| is_final | boolean | NN | места окончательные после разбора всех карт |
| updated_at | timestamptz | NN |  |
- INDEX (tournament_id, rank)


### 7. Мини-лиги
Приватные таблицы по коду.

**`mini_leagues`** — Мини-лига

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| code | text | UQ | SLM9-K7QX |
| name | text | NN |  |
| owner_user_id | bigint | →users NN |  |
| scope | text | NN | tournament | season |
| tournament_id | bigint | →tournaments |  |
| season_id | bigint | →seasons |  |
| created_at | timestamptz | NN |  |

**`mini_league_members`** — Участник мини-лиги

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| mini_league_id | bigint | PK →mini_leagues |  |
| user_id | bigint | PK →users |  |
| joined_at | timestamptz | NN |  |


### 8. Прогнозы
Вопросы по сериям и стадиям, ответы, баллы и медали турнира.

**`pickem_questions`** — Вопрос

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tournament_id | bigint | →tournaments NN |  |
| stage_id | bigint | →stages NN |  |
| series_id | bigint | →series | для вопросов «кто выиграет серию» |
| kind | text | NN | series | two_of | one_of |
| title | text | NN |  |
| options | jsonb | NN | team_id вариантов |
| max_points | smallint | NN |  |
| closes_at | timestamptz | NN | дедлайн стадии или старт серии |
| correct | jsonb |  | заполняется после итога |
| resolved_at | timestamptz |  |  |

**`pickem_answers`** — Ответ менеджера

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| question_id | bigint | PK →pickem_questions |  |
| user_id | bigint | PK →users |  |
| answer | jsonb | NN | {w, sc} | {set} | {w} |
| points | smallint |  | после итога |
| updated_at | timestamptz | NN |  |

**`pickem_results`** — Итог прогнозов за турнир

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| tournament_id | bigint | PK →tournaments |  |
| user_id | bigint | PK →users |  |
| points | smallint | NN |  |
| max_points | smallint | NN |  |
| medal | text |  | bronze | silver | gold | platinum |
| updated_at | timestamptz | NN |  |


### 9. Сезон и лиги
Лестница лиг, членство, раунды, группы по 30 с зонами, Титаны и титулы.

**`league_tiers`** — Лиги (справочник)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | smallint | PK | 1 Рекрут … 8 Титан |
| code | text | UQ | herald…immortal |
| name_ru | text | NN |  |

**`season_ladders`** — Какие лиги активны в сезоне

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| season_id | bigint | PK →seasons |  |
| tier_id | smallint | PK →league_tiers |  |
| is_active | boolean | NN | фазы 1–3 по аудитории |

**`league_memberships`** — Лига менеджера в сезоне

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| season_id | bigint | PK →seasons |  |
| user_id | bigint | PK →users |  |
| tier_id | smallint | →league_tiers | null — калибровка |
| skip_streak | smallint | NN |  |
| best_tier_id | smallint | →league_tiers |  |
| calibrated_at | timestamptz |  |  |

**`league_rounds`** — Раунд лиги = турнир

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| season_id | bigint | →seasons NN |  |
| tournament_id | bigint | →tournaments UQ |  |
| round_no | smallint | NN |  |
| status | text | NN | upcoming | grouped | settled |
| groups_formed_at | timestamptz |  |  |
| settled_at | timestamptz |  |  |

**`league_groups`** — Группа раунда

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| round_id | bigint | →league_rounds NN |  |
| tier_id | smallint | →league_tiers NN |  |
| group_no | smallint | NN |  |
| pooled_key | text |  | сводная таблица нескольких лиг |
| zone_up | smallint | NN | мест в зоне повышения |
| zone_down | smallint | NN |  |

**`league_group_members`** — Менеджер в группе

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| group_id | bigint | PK →league_groups |  |
| user_id | bigint | PK →users |  |
| round_id | bigint | →league_rounds NN | для UNIQUE |
| lineup_id | bigint | →lineups NN |  |
| tier_at_start | smallint | →league_tiers NN |  |
| place | smallint |  |  |
| zone | text |  | up | stay | down |
| tier_after | smallint | →league_tiers |  |
- UNIQUE (round_id, user_id)

**`titan_round_points`** — Очки F1 Титанов за раунд

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| round_id | bigint | PK →league_rounds |  |
| user_id | bigint | PK →users |  |
| season_id | bigint | →seasons NN |  |
| place | smallint | NN |  |
| f1_points | smallint | NN | 25, 18, 15… |

**`season_titles`** — Титулы сезона

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| season_id | bigint | →seasons NN |  |
| user_id | bigint | →users NN |  |
| title | text | NN | best_regular | champion | best_tier |
| tier_id | smallint | →league_tiers |  |
| awarded_at | timestamptz | NN |  |


### 10. Достижения и уведомления
Достижения с уровнями, трофеи, очередь уведомлений.

**`achievements`** — Достижение (справочник)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| code | text | UQ |  |
| name_ru | text | NN |  |
| category | text | NN |  |
| tiers | jsonb |  | пороги уровней |

**`user_achievements`** — Полученное достижение

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| user_id | bigint | PK →users |  |
| achievement_id | bigint | PK →achievements |  |
| tier | smallint | NN |  |
| earned_at | timestamptz | NN |  |
| context | jsonb |  | турнир, игрок, карта |

**`trophies`** — Трофей

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| user_id | bigint | →users NN |  |
| kind | text | NN | promotion | group_first | best_stage | pickem_medal |
| tournament_id | bigint | →tournaments |  |
| season_id | bigint | →seasons |  |
| label | text | NN |  |
| awarded_at | timestamptz | NN |  |

**`notifications`** — Уведомление

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| user_id | bigint | →users NN |  |
| kind | text | NN |  |
| payload | jsonb | NN |  |
| channel | text | NN | telegram | email | push | inapp |
| created_at | timestamptz | NN |  |
| sent_at | timestamptz |  |  |
| read_at | timestamptz |  |  |
- INDEX (user_id, created_at DESC)


### 11. B2B и интеграции наружу
Тенанты (фэнтези под чужим брендом), ключи API партнёров, вебхуки.

**`tenants`** — Тенант (бренд)

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| slug | text | UQ | default, partner-x |
| name | text | NN |  |
| branding | jsonb |  | цвета, шрифты, домен |
| is_default | boolean | NN |  |

**`api_clients`** — Ключ API партнёра

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| tenant_id | bigint | →tenants NN |  |
| name | text | NN |  |
| key_hash | bytea | UQ |  |
| scopes | text[] | NN | read:tournaments, read:standings… |
| rate_limit_per_min | integer | NN |  |
| revoked_at | timestamptz |  |  |

**`webhook_subscriptions`** — Подписка на события

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| api_client_id | bigint | →api_clients NN |  |
| url | text | NN |  |
| events | text[] | NN | map.scored, stage.locked, stage.settled |
| secret_hash | bytea | NN | подпись запросов |
| is_active | boolean | NN |  |

**`webhook_deliveries`** — Доставка вебхука

| Поле | Тип | Ключи | Комментарий |
|---|---|---|---|
| id | bigint | PK |  |
| subscription_id | bigint | →webhook_subscriptions NN |  |
| event | text | NN |  |
| payload | jsonb | NN |  |
| status | text | NN | pending | delivered | failed |
| attempts | smallint | NN |  |
| next_attempt_at | timestamptz |  |  |
| delivered_at | timestamptz |  |  |

## Live в Redis

| Ключ | Тип | Что | Обновление |
|---|---|---|---|
| `live:map:{map_id}` | hash | последний тик карты: счёт, время, net worth, вышки, Рошан | каждые 5–10 с |
| `live:tp_points:{tournament}` | hash | предварительные очки игроков пула за текущую стадию | каждый тик |
| `live:standings:{tournament}` | sorted set | предварительная таблица турнира | раз в 30–60 с |
| `live:group:{round}:{group}` | sorted set | предварительная таблица группы лиги | раз в 30–60 с |
| `channel tournament:{id}` | pub/sub | поток для SSE: дельты очков игроков, события карты | каждый тик |

## Открытые вопросы
- Тенант с первого дня или позже — решение влияет на все пользовательские таблицы.
- Хранить ли live-историю карты (график net worth, лента событий) после её окончания — сейчас live живёт только в Redis.
- Сколько хранить `raw_payloads` по итоговым данным: всегда или год.
- Удаление аккаунта: мягкое (`deleted_at`) + обезличивание ника в таблицах — проверить требования 152-ФЗ.
- Нужна ли история составов команд глубже турниров (`team_rosters`) на старте или хватит `tournament_players`.