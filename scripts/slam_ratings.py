#!/usr/bin/env python3
"""
Рейтинг 0–100 и цены для фэнтези BLAST Slam IX по реальной статистике OpenDota.

Что делает:
  1. Находит account_id всех 80 игроков через /api/proPlayers (по нику + команде).
  2. Тянет их матчи за последние DAYS дней (/api/players/{id}/matches).
  3. Оставляет только официальные лиги уровня premium и professional (/api/leagues).
  4. Считает фэнтези-очки за карту (упрощённо: У/С/П, добивания, GPM, победа),
     взвешивает карты по уровню лиги и свежести.
  5. Нормализует внутри роли -> рейтинг 0–100; ожидаемые очки за турнир -> цена.

Запуск: python3 slam_ratings.py        (только стандартная библиотека, ~2 минуты)
Результат: slam_players.json рядом со скриптом + таблица в консоли.
Если какой-то ник не нашёлся — впиши его account_id в MANUAL_IDS и перезапусти.
"""
import json, math, sys, time, urllib.request, urllib.parse
from pathlib import Path

API = "https://api.opendota.com/api"
DAYS = 180                 # окно статистики
HALF_LIFE = 60             # вес карты падает вдвое каждые 60 дней
TIER_W = {"premium": 1.0, "professional": 0.6}
PRIOR_MAPS = 15            # сжатие к среднему по роли при малом числе карт
PRICE_MIN, PRICE_MAX = 4.5, 12.5
PRICE_CURVE = 1.3          # >1 — выгнутая шкала: звёзды премиум, середина дешевле (бюджет в игре — 48)
SLEEP = 1.1                # бесплатный лимит OpenDota — 60 запросов в минуту

ROLES = ["carry", "mid", "off", "soft", "hard"]
ROSTERS = {  # позиции 1–5, по заявкам BLAST Slam VIII
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
# Известные ID (проверены по notable_players OpenDota). Дополняй, если скрипт не нашёл игрока.
MANUAL_IDS = {
    "Yatoro": 321580662, "Larl": 106305042, "Batyuk": 140835095,
    "not me": 218231587, "rue": 847565596,
}

def get(path, **params):
    url = f"{API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params, doseq=True)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "slam-fantasy"}), timeout=60) as r:
                data = json.load(r)
            time.sleep(SLEEP)
            return data
        except Exception as e:  # 429 / таймаут — ждём и пробуем снова
            wait = 5 * (attempt + 1)
            print(f"  ! {path}: {e} — повтор через {wait} с", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"Не удалось получить {url}")

def norm(s):
    return "".join(ch for ch in s.lower() if ch.isalnum() or ch == " " or ord(ch) > 127).strip()

def team_match(a, b):
    a, b = norm(a or ""), norm(b or "")
    return bool(a and b) and (a in b or b in a)

def resolve_ids():
    pros = get("/proPlayers")
    ids, missing = {}, []
    for team, nicks in ROSTERS.items():
        for nick in nicks:
            if nick in MANUAL_IDS:
                ids[nick] = MANUAL_IDS[nick]; continue
            cands = [p for p in pros if norm(p.get("name") or "") == norm(nick)]
            if not cands:
                missing.append((team, nick)); continue
            cands.sort(key=lambda p: (team_match(p.get("team_name"), team), p.get("last_match_time") or ""), reverse=True)
            ids[nick] = cands[0]["account_id"]
            if len(cands) > 1 and not team_match(cands[0].get("team_name"), team):
                print(f"  ? {nick}: несколько кандидатов, взят {cands[0]['account_id']} ({cands[0].get('team_name')})")
    return ids, missing

def fantasy_lite(m):
    win = (m["player_slot"] < 128) == bool(m["radiant_win"])
    return (m["kills"] * 0.3 - m["deaths"] * 0.3 + m["assists"] * 0.15
            + (m.get("last_hits") or 0) * 0.003 + (m.get("gold_per_min") or 0) * 0.002
            + (3 if win else 0)), win

def main():
    print("1/3 Ищу игроков…")
    ids, missing = resolve_ids()
    for team, nick in missing:
        print(f"  ✗ не найден: {nick} ({team}) — впиши ID в MANUAL_IDS")

    print("2/3 Загружаю уровни лиг…")
    tiers = {l["leagueid"]: l.get("tier") for l in get("/leagues")}

    print("3/3 Загружаю матчи игроков…")
    now = time.time()
    rows = []
    for team, nicks in ROSTERS.items():
        for role, nick in zip(ROLES, nicks):
            acc = ids.get(nick)
            row = {"team": team, "nick": nick, "role": role, "account_id": acc,
                   "maps": 0, "w_maps": 0.0, "pts": None, "wins_w": 0.0}
            if acc:
                ms = get(f"/players/{acc}/matches", date=DAYS, significant=0,
                         project=["kills", "deaths", "assists", "last_hits", "gold_per_min",
                                  "leagueid", "start_time", "player_slot", "radiant_win"])
                s = 0.0
                for m in ms:
                    w_tier = TIER_W.get(tiers.get(m.get("leagueid")))
                    if not w_tier:
                        continue
                    w = w_tier * 0.5 ** ((now - m["start_time"]) / 86400 / HALF_LIFE)
                    pts, win = fantasy_lite(m)
                    s += w * pts; row["w_maps"] += w; row["maps"] += 1; row["wins_w"] += w * win
                if row["w_maps"]:
                    row["pts"] = s / row["w_maps"]
            rows.append(row)
            print(f"  {team:16} {nick:14} карт: {row['maps']:3}")

    # --- рейтинг: сжатие к среднему роли + z-оценка внутри роли
    for role in ROLES:
        rr = [r for r in rows if r["role"] == role]
        have = [r for r in rr if r["pts"] is not None]
        mean = sum(r["pts"] for r in have) / max(1, len(have))
        for r in rr:
            k = r["w_maps"] / (r["w_maps"] + PRIOR_MAPS)
            r["pts_shrunk"] = mean + k * ((r["pts"] if r["pts"] is not None else mean) - mean)
        sd = math.sqrt(sum((r["pts_shrunk"] - mean) ** 2 for r in rr) / len(rr)) or 1
        for r in rr:
            r["z"] = (r["pts_shrunk"] - mean) / sd
            r["rating"] = max(60, min(96, round(80 + 6 * r["z"])))
            r["pts_norm"] = 10 * r["pts_shrunk"] / mean      # очки за карту с учётом роли (среднее = 10)

    # --- сила команды: взвешенный винрейт состава -> ожидаемое число карт на турнире
    for team in ROSTERS:
        tr = [r for r in rows if r["team"] == team]
        wr = sum(r["wins_w"] for r in tr) / max(1e-9, sum(r["w_maps"] for r in tr))
        for r in tr:
            r["team_wr"] = round(wr, 3)
            r["exp_maps"] = 6 + 14 * max(0.0, min(1.0, (wr - 0.35) / 0.35))   # ~6 карт у слабых, ~20 у топов

    ev = [r["pts_norm"] * r["exp_maps"] for r in rows]
    lo, hi = min(ev), max(ev)
    for r, e in zip(rows, ev):
        r["exp_pts"] = round(e, 1)
        r["price"] = round((PRICE_MIN + ((e - lo) / (hi - lo or 1)) ** PRICE_CURVE * (PRICE_MAX - PRICE_MIN)) * 2) / 2
        r["pts_map"] = round(r["pts_norm"], 2)

    keep = ["team", "nick", "role", "account_id", "maps", "team_wr", "pts_map", "rating", "exp_pts", "price"]
    out = [{k: r[k] for k in keep} for r in rows]
    path = Path(__file__).with_name("slam_players.json")
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nГотово: {path}")
    for r in sorted(out, key=lambda r: -r["price"]):
        print(f"{r['price']:5.1f}  {r['rating']:3}  {r['nick']:14} {r['team']:16} {r['role']:6} карт {r['maps']:3}  винрейт {r['team_wr']:.2f}")

if __name__ == "__main__":
    main()
