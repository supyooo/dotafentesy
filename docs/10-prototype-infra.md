# 08. Инфраструктура прототипа: оформления турниров, данные, заставка, хостинг, скрипты

Сделано в Claude Code 29 сентября – 2 октября 2026, параллельно с работой в чате (docs/01–07). Пакет из чата
`dota-fantasy-claude-code2.zip` (2 октября) влит поверх: продуктовая часть (хаб, кабинет, прогнозы, сезон, состав+рынок) — из чата,
всё ниже — отсюда. Резервная копия версии до слияния — у Claude в scratchpad, в репозитории её нет.

## Как прототип собран (`prototype/index.html`)
- Файл из чата был фрагментом без `<html>/<head>/<meta charset>` — обёртка добавлена (иначе локальный сервер показывает кракозябры).
- **Данные** — `prototype/data/*.json`, грузятся через `fetch` в начале основного скрипта (IIFE стал `async`), поэтому сайт работает
  только через сервер, не `file://`; при ошибке загрузки — плашка с подсказкой. Структура повторяет будущие таблицы:
  `teams.json` (id, name, tag, hue) · `players.json` (id-слаг, nick, **account_id**, aliases, photo, rating_bonus_tmp) ·
  `rosters.json` (состав на турнир: команда → позиции 1–5 → id игрока, статус, strength_tmp; группы) ·
  `tournaments.json` (formats со стадиями; tournaments: мета, theme, roster, format).
  Порядок команд/игроков в составе задаёт числовые id игроков в сохранённых составах пользователей — не переставлять без миграции localStorage.
  После любой правки данных: `python scripts/validate_data.py`.
- **5 турниров** (`TOURS` из tournaments.json): The International 2026, BLAST Slam IX, EWC, PGL Wallachia S9, DreamLeague.
  На главной: «Идёт» — BLAST; «Скоро» — DreamLeague, EWC; «Прошли» — TI (играбельное демо), Slam VIII и Wallachia (итоги-примеры из кабинета).
  У каждого турнира своё оформление (`data-t`/`data-skin`), фирменная шапка (`renderHero`), заставка (`playIntro`)
  и экран перехода между стадиями (`tiStage`/`blStage`/`ewStage`/`walStage`/`dlStage`).
- **Стартовая заставка «Сетка»** — `prototype/intro/df-intro.{js,css}` (`DFIntro.play('bracket')`), раз за сессию (`df-splash`).
  Наши правки в df-intro: страховка удаления оверлея по таймеру (в скрытой вкладке onfinish не наступает); `dfi-wait` — пока грузится
  шрифт, виден только фон (без «фото» готового кадра); на телефоне сетка повёрнута на 90°, «DOTA / FANTASY» в две строки.
  Против мелькания шапки: инлайн-скрипт в `<head>` ставит `html.dfi-pending`, `splash()` — первая строка скрипта, до загрузки JSON.
- **Логотип** (`.brand`) — Saira wdth 125 / wght 900 + SVG «сетка → красная точка чемпиона» (#E3361F), цвет — `var(--ink)` темы.

- **Фиксация состава** (страница «Состав и рынок», блок `#lock-bar`, `renderLock`/`lockLineup`): кнопка «Зафиксировать состав»
  с подтверждением вторым нажатием; только при полной пятёрке, капитане и банке ≥ 0. `S.locked=true` блокирует `pick`/`drop`,
  капитана, «Тройного капитана», отмену/Ctrl+Z и «Вернуть состав окна»; на рынке у кнопок title с причиной. Снимается в `play()`
  после сыгранной стадии (новое окно). Хранится в состоянии турнира (`df-fantasy-v7-<tour>`). В спеке (docs/02) такого шага нет —
  решение автора 02.10.2026; для бэкенда: флаг на lineup текущего окна.
- **Логотипы команд** — `prototype/teams/<id>.webp` (поле `logo` в teams.json), из Steam: команды сами загружают их в Dota 2,
  берём через OpenDota `/teams/{steam_team_id}` → `logo_url` (cdn.steamusercontent.com). `steam_team_id` проверены по составам
  в матчах Slam VIII. Обновление: `python scripts/fetch_team_logos.py [--skip id,id]` (нужен Pillow). Показываются в прогнозах
  (`pkSw` → `.tlogo`, тёмная плашка: у Spirit/XG/Liquid/GL логотипы белые). В Steam 1w Team зарегистрирована как **1win** — логотип
  букмекера «1W»; у Aurora в логотипе спонсор **1XBET**; у LGD устаревший PSG.LGD — автор решил оставить все как есть (02.10.2026).
- **Медали рангов** для лиг — `prototype/ranks/1..8.webp` (Рекрут/Herald … Титан/Immortal), оригинальная графика из игры с хоста OpenDota
  (`opendota.com/assets/images/dota2/rank_icons/rank_icon_N.png`; на открытом CDN Valve их нет). `rankIc(лига|индекс)` — на странице
  сезона (шапка, таблица группы, границы зон, «лестница»), в хабе и в кабинете (поле «Лига», график пути по лигам).
  Картинка автора `image-14-104.jpg` (инфографика esports.ru) — справочная: в ней 7 рангов без Титана, медали мелкие на фоне.

## Оформления турниров — источники и правила
Решение автора 29.09.2026: прототип — питч для операторов, оформления по их официальным материалам. Каждая шапка помечена
«Концепт для … · неофициально». Источники — только официальные (киты, бренд-порталы, сайты турниров), не фан-архивы и не портфолио.
- `brand/blast/` — медиакит BLAST (mediakit.blast.tv): кристалл-логотип, узор, KV.
- `brand/ewc/` — из `EWC_26_GRAPHIC_KIT_*.pdf` (корень проекта, 66 МБ): логотип EWC (отрендерен из вектора), 3D-трофей, ключ-токен,
  иконка ключа, 3D-фоны, текстура градиента. Правила кита: charcoal #231F20 / off-white #F7F7F7; золото #D1B26E и оранжевый #FF3600 —
  только градиентом gold→orange→off-white; градиентный логотип только на сплошном фоне; «нотч» — трапеция по углам иконки-ключа.
  Шрифт Gear недоступен → Saira Extra Condensed / Barlow / Roboto Mono.
- `brand/dreamleague/` — бренд-портал ESL FACEIT Group (brand.eslfaceitgroup.com → ESL Brand Playbook → Sub-brands): логотип
  «DreamLeague × Intel» (партнёрский блок не отрезать) и логотип ESL Pro Tour (показывать рядом с турниром). Стиль — с сайта
  pro.eslgaming.com/dreamleague: #050000 с «дымом», красный #FF003C, неон #FFF5BF (приём `.dl-neon` = их `.dl-title-effect`).
  ESL Legend → Big Shoulders Display, Calps Sans → Barlow. Исходные zip — `_kits/`. Контакты: press@efg.gg, brand [at] efg.gg.
- `brand/wallachia/` — кита у PGL нет; с официальных страниц pglesports.com/dota2/wallachia-sN-YYYY/ (логотип S9, орнамент S7, логотип PGL).
  Лайм #8FBD1E на чёрном, линии с ромбами; MarkPro/DINPro → Cinzel + Barlow. Запрос кита — форма pglesports.com/contact.
- `brand/ti/` — публичного кита у Valve нет (брендбук TI 2026 только подрядчикам трансляции, см. RFP_TI_2026.pdf на CDN Valve;
  TI 2026 делали Valve + PGL). С официальных ресурсов Valve: логотип `.../dota_react/international2026/ti2026_logo.png`,
  шапка `.../dpc/headers/dpc_header_event_ti15.png`, арт «SHANGHAI» из анонса. Тема — вышивка и золотые нити; Reaver/Radiance → Cinzel + Barlow.
- В продакшен (реальные пользователи, монетизация) — только с письменного согласия каждого правообладателя.
  Если правообладатель попросит убрать материалы — убрать сразу.

## Хостинг
- **https://dota-fantasy.pages.dev** — Cloudflare Pages, аккаунт автора (wrangler залогинен на его компьютере).
  Деплой: `npx wrangler pages deploy prototype --project-name dota-fantasy --branch main` (выкладывается только `prototype/`).
  `prototype/_headers`: `X-Robots-Tag: noindex` (не снимать), `/data/*` без кэша. Несуществующие пути отдают index.html (200) — не утечка.
- Яндекс Браузер и системный DNS провайдера не открывают `*.pages.dev` (блокировка на уровне DNS); Chrome/Edge открывают (secure DNS).
  Решение — свой домен на том же проекте (отложено автором). Для curl: `--resolve dota-fantasy.pages.dev:443:<IP из nslookup … 1.1.1.1>`.
- Локально: `python scripts/serve.py` (без кэша, весь проект) → http://localhost:8000; `--share [порт]` — только `prototype/`,
  basic-auth (логин guest, пароль в `.share_password`, в .gitignore) + noindex; `--share --open` — то же без пароля.

## Скрипты (Python, стандартная библиотека)
- `scripts/fill_account_ids.py [--league ID] [--write]` — account_id игроков по OpenDota `/proPlayers` и реальным составам в матчах лиги;
  пишет только совпадения «ник/alias + команда», показывает расхождения составов.
- `scripts/validate_data.py` — целостность `prototype/data/*.json` (ошибки → код 1; нет account_id/фото — предупреждения).
- `scripts/serve.py` — локальный сервер (см. выше).

## Данные игроков — состояние на 30.09.2026
- account_id: 69/81. Не хватает 12 — BetBoom (swedenstrong), Yandex (watson, ATF, Malady), MOUZ (423, Supream^, mrls, MoOz),
  OG (Topson, SSS, OneJey): их команды ещё не играли на Slam VIII — `python scripts/fill_account_ids.py --league 19102 --write` по мере матчей.
- Сверка по матчам Slam VIII (позиции по нетворсу/линиям): GamerLegion — **Yuma (177203952) заменил Timado** на керри (Timado в players.json
  вне составов; у Yuma нет фото). Сменили ник без смены состава (`aliases`): Ainkrad → «darkniA», JaCkky → «JACKBOYS», Jabz → «J», miCKe → «m1CKe».
- Фото: нет у mrls (MOUZ) и Yuma.
