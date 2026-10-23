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
- **6 турниров** (`TOURS` из tournaments.json): The International 2026, BLAST Slam VIII (реальные данные), PARI Universe, EWC,
  PGL Wallachia S9, DreamLeague Season 30 (анонс).
  На главной (с 15.10.2026): «Скоро» — PARI Universe (текущий раунд сезона, калибровка), DreamLeague S30, EWC; «Прошли» — турниры
  с `past: true` и выгрузкой replay, сейчас BLAST Slam VIII: экран итогов (чемпион, группы, сетка, кого брали, лучшие игроки, твой состав —
  docs/05). TI 2026 скрыт до разметки плей-офф. Пример сезона в кабинете убран — новый игрок начинает с нуля (docs/05).
  В main у турниров единый стиль с акцентным цветом, общие шапка (`renderHero`), заставка (`playIntro`) и переход стадии (`stageFx`) —
  см. «Чистая версия» ниже. В ветке official-kits — своё оформление каждого турнира и экраны перехода `tiStage`/`blStage`/… .
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
- **Логотипы команд** (только ветка official-kits; в main — значки `tBadge`) — `prototype/teams/<id>.webp` (поле `logo` в teams.json), из Steam: команды сами загружают их в Dota 2,
  берём через OpenDota `/teams/{steam_team_id}` → `logo_url` (cdn.steamusercontent.com). `steam_team_id` проверены по составам
  в матчах Slam VIII. Обновление: `python scripts/fetch_team_logos.py [--skip id,id] [--only id,id]` (нужен Pillow).
  У Astra Invicta логотипа нет (команды ещё нет ни в Steam-матчах, ни на Liquipedia). Показываются в прогнозах
  (`pkSw` → `.tlogo`, тёмная плашка: у Spirit/XG/Liquid/GL логотипы белые). В Steam 1w Team зарегистрирована как **1win** — логотип
  букмекера «1W»; у Aurora в логотипе спонсор **1XBET**; у LGD устаревший PSG.LGD — автор решил оставить все как есть (02.10.2026).
- **Медали рангов** для лиг — `prototype/ranks/1..8.webp` (Рекрут/Herald … Титан/Immortal), оригинальная графика из игры с хоста OpenDota
  (`opendota.com/assets/images/dota2/rank_icons/rank_icon_N.png`; на открытом CDN Valve их нет). `rankIc(лига|индекс)` — на странице
  сезона (шапка, таблица группы, границы зон, «лестница»), в хабе и в кабинете (поле «Лига», график пути по лигам).
  Картинка автора `image-14-104.jpg` (инфографика esports.ru) — справочная: в ней 7 рангов без Титана, медали мелкие на фоне.

- **Турнир на реальных данных** (12.10.2026, до API — B6): поле `replay` в `tournaments.json` → `data/replay/<slug>.json`, выгрузка из базы
  `pnpm --filter @df/worker cli export-replay blast-slam-8` (в выгрузке также формат стадий и названия команд — для экрана итогов).
  BLAST (`id: blast` = Slam VIII) с 15.10 — прошедший (`past: true`), показывает итоги; движок проигрывания остался: «Сыграть стадию» брал
  настоящие серии по паре команд в стадии (`runStage` → `realSeries`), очки игрока за стадию — из выгрузки (очки серии как у BLAST),
  рейтинг (docs/12, целым) и цена v1 (рейтинг + сила команды) — на старте и после каждой стадии (`applyTourData`, `computeDeltas`).
  Прогресс — в отдельном ключе localStorage (`keyOf` с именем выгрузки). Остальные турниры — прежняя симуляция.
  Сетка прототипа исправлена под настоящий формат BLAST Slam: посев A1–D1 и B1–C1; нижняя сетка без повторных встреч.
  После правки выгрузки — снова `export-replay` и деплой.
- **Форматы и составы по турнирам** (13.10.2026): у каждого турнира свой `roster` и `format`; при смене турнира пул игроков, стадии
  и группы пересобираются (`buildPool`), число стадий — `NS()`. Форматы движка: `slam` (GSL → посев/Last Chance → плей-офф на 6 → финальный
  день; `runSlam`, `bkGroups`/`bkPlayoff`) и `pari` (две группы по 5 по кругу, очко за карту → double elimination на 8 → финальные дни;
  `runPari`, `rrSchedule`/`rrTable`, `pariSeeding`, `bkRR`/`bkDE8`). Прогнозы в обоих — 34 серии, максимум 68.
  Посев PARI в симуляции: лидеры групп берут более слабую из 3–4 мест другой группы, вторые места — оставшихся (по регламенту лидеры
  выбирают соперников сами). Тай-брейк за выход (равные очки у 4-го и 5-го) — Bo3.
- **Будущий турнир с пулом из базы**: поле `pool` → `data/pool/<slug>.json` (`cli export-pool <slug>`): заявка из регламента, стартовый
  рейтинг (docs/12) и цена v1. Турнир играется симуляцией от этих значений. Игрок не объявлен (`players: null` или нет позиции в составе) —
  место «не объявлен»: в симуляции рейтинг дебютанта 75, на рынке его не взять. Так сейчас PARI Universe (`id: pari`).
- **Анонс** (`open: false`): фэнтези закрыто, пул и прогресс не пересобираются — только обзор (`renderAnnounce`): стадии, участники
  и места отборочных (`slots` в составе), формат, пустая сетка. Так сейчас DreamLeague Season 30.
- Блок «Участники, формат, сетка» на обзоре (`renderTourInfo`) — у турниров с `participants: true`.

## Чистая версия (main) и ветка с китами (official-kits) — с 23.10.2026
Решение автора 23.10.2026 (сменилась стратегия продвижения): в main и на основном адресе — никакой чужой графики.
- Фото игроков → **монограмма** (`monoTxt`: две буквы ника, у ника из нескольких слов — первые буквы слов) на плашке цвета команды;
  в большой карточке (`.art .mono`) и в аватарке (`.ava .mono`). У неизвестного игрока («не объявлен») — силуэт `SIL`.
- Логотипы команд → **значок** `tBadge(tag, hue)`: тег на плашке цвета команды, размер шрифта подстраивается под длину тега (`--l`).
- Киты организаторов → **единый стиль сайта** (светлая «бумага», Saira); у турнира только акцентный цвет (`:root[data-t]`/`[data-skin]`,
  контраст текста и кнопок ≥ 4.5:1): PARI #0A7471, BLAST #2D4BD8, DreamLeague #C2124D, Wallachia #3F7A17, TI #9A6200, EWC #C2410C.
  В шапке и карточке турнира — своя схема сетки `ART()` (линии сходятся к точке чемпиона, как в логотипе сайта); название турнира — текстом
  (`sup`/`main`/`em` из tournaments.json). Заставка турнира — общая (`playIntro`: полосы и линия цвета турнира), переход стадии — `stageFx`.
- Внизу страницы и в меню — дисклеймер: неофициальный фан-проект, не связан с Valve, организаторами и командами; Dota 2 — товарный знак Valve.
- Папки `prototype/photos`, `prototype/teams`, `prototype/brand` и поля `photo`/`logo` в данных из main удалены; `validate_data.py`
  считает их ошибкой. Скрипты `fetch_team_logos.py` и `slam_photos.py` остались — для ветки official-kits.
- **official-kits** — снимок main на 23.10.2026 (коммит 259b53a6: киты, 81 фото, логотипы команд). Деплой из этой ветки:
  `npx wrangler pages deploy prototype --project-name dota-fantasy --branch kits` → https://kits.dota-fantasy.pages.dev (тоже noindex).
  Всё, что ниже про `brand/`, фото и логотипы, относится к этой ветке.

## Оформления турниров — источники и правила (ветка official-kits)
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
- `brand/pari/` — кита у FISSURE нет (сайт fissure.tv не открывается, пресс-материалов не нашли); из официальных визуалов в Telegram
  организатора @fissure_pro_dota2 (посты 8287 — анонс, 8288 — квалификации, 8296 — инвайты, 800 px): `kv.webp` и `kv-card.webp` — арт
  с героем, `planet.webp` — горизонт планеты, `logo.webp` — логотип PARI UNIVERSE (фон-планета убран по яркости). Стиль — открытый космос,
  бирюзовая атмосфера #2EE6D0, HUD-рамки со срезанными углами; шрифт логотипа закрытый → Unbounded + Manrope. Заставка — планета
  поднимается, вспышка на горизонте; переход стадии — расходящиеся орбиты (`paStage`). PARI — букмекер-спонсор: ссылок на него нет.
- В продакшен (реальные пользователи, монетизация) — только с письменного согласия каждого правообладателя.
  Если правообладатель попросит убрать материалы — убрать сразу.

## Живые данные идущего турнира (с 23.10.2026, PARI Universe)
- Генератор `apps/worker/src/live-feed.ts` (`pnpm --filter @df/worker live-feed <slug> [--out] [--cache]`) — **без базы**: регламент
  (`packages/db/tournaments/<slug>.json`: league id, стадии, узлы с парами и группами), пул (`prototype/data/pool/<slug>.json`: стартовые
  рейтинг и цена, позиции) → OpenDota (карты лиги, разбор реплея заказывает сам) → очки `@df/domain` (`mapPoints`, `seriesPoints`, правила
  2026.10-spec, бонус 5) → серии по узлам регламента (группа — по паре команд, сетка — по ближайшему времени) → `prototype/data/live/<slug>.json`.
  До разбора реплея карта считается по уровню basic (без оглушений, вардов, стаков), после — пересчитывается. Рейтинг и цена — стартовые.
  Пишет файл, только если данные изменились (`generated` — время изменения). Кэш разобранных карт — `.cache/live-<slug>.json`.
- **GitHub Actions** `live-feed` (`.github/workflows/live-feed.yml` + `.github/scripts/live-feed.sh`): каждые 3 ч запуск на ~5 ч 45 мин,
  опрос раз в 3 минуты, коммит в ветку **live-feed** (`<slug>.json` и кэш). Сайт читает `https://raw.githubusercontent.com/supyooo/dotafentesy/live-feed/<slug>.json`
  (CDN кэширует до ~5 минут). Без секретов. Турнир — `TOURNAMENT` в workflow; после турнира — выключить (Disable workflow).
- Перед плей-офф: вписать пары 1/4 в узлы UBQF1–4 регламента (Liquipedia), иначе пары в прогнозах — из посева симуляции до первой карты.
- Старый `live-poll` (Steam, спайк Slam VIII) — расписание снято 23.10, остался ручной запуск.

## Хостинг
- **https://dota-fantasy.pages.dev** — Cloudflare Pages, аккаунт автора (wrangler залогинен на его компьютере).
  Деплой: `npx wrangler pages deploy prototype --project-name dota-fantasy --branch main` (выкладывается только `prototype/`) — из ветки main.
  Версия с китами — из ветки official-kits с `--branch kits` → https://kits.dota-fantasy.pages.dev.
  `prototype/_headers`: `X-Robots-Tag: noindex` (не снимать), `/data/*` без кэша. Несуществующие пути отдают index.html (200) — не утечка.
  Документ «Как считаются рейтинг, цены и очки» — `prototype/formuly.html` → https://dota-fantasy.pages.dev/formuly (чтобы делиться ссылкой).
- Яндекс Браузер и системный DNS провайдера не открывают `*.pages.dev` (блокировка на уровне DNS); Chrome/Edge открывают (secure DNS).
  Решение — свой домен на том же проекте (отложено автором). Для curl: `--resolve dota-fantasy.pages.dev:443:<IP из nslookup … 1.1.1.1>`.
- Локально: `python scripts/serve.py` (без кэша, весь проект) → http://localhost:8000; `--share [порт]` — только `prototype/`,
  basic-auth (логин guest, пароль в `.share_password`, в .gitignore) + noindex; `--share --open` — то же без пароля.

## Скрипты (Python, стандартная библиотека)
- `scripts/fill_account_ids.py [--league ID] [--write]` — account_id игроков по OpenDota `/proPlayers` и реальным составам в матчах лиги;
  пишет только совпадения «ник/alias + команда», показывает расхождения составов.
- `scripts/validate_data.py` — целостность `prototype/data/*.json` (ошибки → код 1, в т.ч. поля photo/logo в main; нет account_id — предупреждение).
- `scripts/serve.py` — локальный сервер (см. выше).

## Данные игроков — состояние на 30.09.2026
- account_id: 69/81. Не хватает 12 — BetBoom (swedenstrong), Yandex (watson, ATF, Malady), MOUZ (423, Supream^, mrls, MoOz),
  OG (Topson, SSS, OneJey): их команды ещё не играли на Slam VIII — `python scripts/fill_account_ids.py --league 19102 --write` по мере матчей.
- Сверка по матчам Slam VIII (позиции по нетворсу/линиям): GamerLegion — **Yuma (177203952) заменил Timado** на керри (Timado в players.json
  вне составов; у Yuma нет фото). Сменили ник без смены состава (`aliases`): Ainkrad → «darkniA», JaCkky → «JACKBOYS», Jabz → «J», miCKe → «m1CKe».
- Фото (ветка official-kits): нет у mrls (MOUZ). 23.10 — новые фото Spirit, swedenstrong, Yuma и Malr1ne (прислал автор).
- 23.10: мид Team Liquid на PARI Universe — **Malr1ne (898455820)**, по матчам турнира; в одном матче против GamerLegion керри — rincyq (замена).
