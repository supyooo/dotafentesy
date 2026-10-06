#!/usr/bin/env python3
"""
Фото и профили 80 игроков BLAST Slam IX для фэнтези-прототипа.

Для каждого игрока:
  1. Liquipedia — главное фото страницы игрока + автор и лицензия (обычно CC BY-SA).
  2. Cybersport.ru — ссылка на профиль (https://www.cybersport.ru/players/dota-2/<slug>)
     и, если на Liquipedia фото нет, картинка профиля (og:image) как запасной вариант.

Запуск:  python3 slam_photos.py       (только стандартная библиотека, ~6–8 минут из-за лимитов Liquipedia)
Результат: папка slam_photos/ с картинками и manifest.json. Заархивируй папку и пришли в чат.

Правила Liquipedia: осмысленный User-Agent с контактом и не чаще 1 запроса в 2 секунды — скрипт это соблюдает.
Фото с cybersport.ru принадлежат редакции: для личного прототипа можно, для публичного сайта — только с разрешения.
"""
import gzip, html, json, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

CONTACT = "your-email@example.com"   # Liquipedia требует контакт в User-Agent — замени на свой
UA = f"SlamFantasyPrototype/0.1 ({CONTACT})"
LP_API = "https://liquipedia.net/dota2/api.php"
LP_DELAY = 2.2
CS_BASE = "https://www.cybersport.ru/players/dota-2/"
OUT = Path(__file__).with_name("slam_photos")

ROLES = ["carry", "mid", "off", "soft", "hard"]
ROSTERS = {
    "Team Spirit":     ["Yatoro", "Larl", "Batyuk", "not me", "rue"],
    "PARIVISION":      ["Satanic", "No[o]ne-", "Noticed", "9Class", "Dukalis"],
    "Xtreme Gaming":   ["Ame", "Moon", "Zeal", "XinQ", "BoBoKa"],
    "BetBoom Team":    ["Kiritych~", "Save-", "MieRo", "swedenstrong", "Kataomi`"],
    "Team Yandex":     ["watson", "CHIRA_JUNIOR", "ATF", "Saksa", "Malady"],
    "Aurora Gaming":   ["skiter", "Mikoto", "Ws", "Mira", "kaori"],
    "Team Liquid":     ["miCKe", "MidOne", "Wisper", "Boxi", "tOfu"],
    "1w Team":         ["Pure", "bzm", "33", "Ari", "Whitemon"],
    "Natus Vincere":   ["gotthejuice", "Niku", "pma", "daze", "Riddys"],
    "MOUZ":            ["423", "Supream^", "BOOM", "mrls", "MoOz"],
    "OG":              ["Natsumi", "Topson", "SSS", "OneJey", "skem"],
    "LGD Gaming":      ["Wits", "SumaiL-", "Davai", "Thiolicor", "Sneyking"],
    "GamerLegion":     ["Timado", "RCY", "Fayde", "Bignum", "Speeed"],
    "Level UP":        ["WoE", "Ainkrad", "bb3px", "queezy", "Htrd"],
    "Yakult Brothers": ["Lou", "Emo", "Beyond", "kaka", "天命"],
    "Team Nemesis":    ["JaCkky", "Ken", "Jabz", "Jhocam", "NARMAN"],
}
# Если скрипт промахнулся со страницей — впиши точное название страницы Liquipedia или slug cybersport.ru.
LP_TITLE = {"No[o]ne-": "No[o]ne", "SumaiL-": "SumaiL", "Save-": "Save-", "Kiritych~": "Kiritych", "Kataomi`": "Kataomi",
            "Supream^": "Supream"}
CS_SLUG = {}

def http(url, binary=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return (data, r.headers.get("Content-Type", "")) if binary else data.decode("utf-8", "replace")

def lp(**params):
    params.update(format="json", formatversion=2)
    time.sleep(LP_DELAY)
    return json.loads(http(LP_API + "?" + urllib.parse.urlencode(params)))

def safe(nick, team, i):
    s = re.sub(r"[^A-Za-z0-9_-]+", "", nick)
    return s or f"{''.join(w[0] for w in team.split())}_{i + 1}"

def liquipedia_photo(nick, team):
    """Возвращает (url, author, license, page) или None. Проверяет, что страница про игрока нужной команды."""
    title = LP_TITLE.get(nick, nick)
    candidates = [title, f"{title} (player)"]
    for t in candidates:
        d = lp(action="query", titles=t, redirects=1, prop="pageimages|revisions", piprop="name",
               rvprop="content", rvslots="main", rvsection=0)
        pages = d.get("query", {}).get("pages", [])
        if not pages or pages[0].get("missing"):
            continue
        pg = pages[0]
        text = pg.get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")
        if "disambig" in text.lower():
            continue  # страница-омоним: пробуем «(player)»
        if team.split()[0].lower() not in text.lower() and "Infobox player" not in text:
            continue
        img = pg.get("pageimage")
        if not img:
            return None
        info = lp(action="query", titles=f"File:{img}", prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=600)
        ii = info["query"]["pages"][0]["imageinfo"][0]
        meta = ii.get("extmetadata", {})
        strip = lambda v: re.sub(r"<[^>]+>", "", html.unescape((v or {}).get("value", ""))).strip()
        return (ii.get("thumburl") or ii["url"], strip(meta.get("Artist")), strip(meta.get("LicenseShortName")),
                "https://liquipedia.net/dota2/" + urllib.parse.quote(pg["title"].replace(" ", "_")))
    return None

def cybersport(nick):
    slug = CS_SLUG.get(nick) or re.sub(r"[^a-z0-9_-]+", "", nick.lower().replace(" ", "-"))
    if not slug:
        return None, None
    url = CS_BASE + slug
    try:
        page = http(url)
    except urllib.error.HTTPError:
        return None, None
    m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', page) or \
        re.search(r'<meta[^>]+content="([^"]+)"[^>]+property="og:image"', page)
    return url, (html.unescape(m.group(1)) if m else None)

def download(url, stem):
    data, ctype = http(url, binary=True)
    ext = ".png" if "png" in ctype else ".webp" if "webp" in ctype else ".jpg"
    path = OUT / (stem + ext)
    path.write_bytes(data)
    return path.name

def main():
    OUT.mkdir(exist_ok=True)
    manifest, missing = [], []
    for team, nicks in ROSTERS.items():
        for i, (role, nick) in enumerate(zip(ROLES, nicks)):
            row = {"team": team, "nick": nick, "role": role, "file": None, "source": None,
                   "author": None, "license": None, "source_page": None, "cybersport": None}
            try:
                lpres = liquipedia_photo(nick, team)
            except Exception as e:
                print(f"  ! Liquipedia {nick}: {e}", file=sys.stderr); lpres = None
            try:
                cs_url, cs_img = cybersport(nick)
            except Exception as e:
                print(f"  ! cybersport {nick}: {e}", file=sys.stderr); cs_url, cs_img = None, None
            row["cybersport"] = cs_url
            try:
                if lpres:
                    url, author, lic, page = lpres
                    row.update(file=download(url, safe(nick, team, i)), source="liquipedia",
                               author=author, license=lic, source_page=page)
                elif cs_img:
                    row.update(file=download(cs_img, safe(nick, team, i)), source="cybersport.ru",
                               license="© cybersport.ru — только для личного прототипа", source_page=cs_url)
            except Exception as e:
                print(f"  ! загрузка {nick}: {e}", file=sys.stderr)
            if not row["file"]:
                missing.append(f"{nick} ({team})")
            manifest.append(row)
            print(f"  {team:16} {nick:14} фото: {row['source'] or '—':13} профиль: {'да' if cs_url else '—'}")
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nГотово: {OUT}  (фото: {80 - len(missing)} из 80)")
    if missing:
        print("Без фото — поправь LP_TITLE / CS_SLUG и перезапусти:\n  " + "\n  ".join(missing))

if __name__ == "__main__":
    main()
