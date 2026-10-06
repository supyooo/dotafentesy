#!/usr/bin/env python3
"""
Сборщик статистики BLAST Slam для фэнтези: очки только за ЗАВЕРШЁННЫЕ карты.

Раз в POLL секунд:
  1. /leagues/{LEAGUE}/matches  — список сыгранных карт турнира (карта попадает туда после окончания)
  2. /matches/{id}              — статистика; если реплей ещё не разобран, шлём /request/{id} и ждём
  3. считает очки по правилам прототипа и пишет slam_live.json

Запуск:   python3 slam_live.py            (бесконечно, Ctrl+C — стоп)
          python3 slam_live.py --once     (один проход)
          python3 slam_live.py --league 20208   (BLAST Slam IX, когда начнётся)
Только стандартная библиотека Python 3.8+.
"""
import argparse, json, sys, time, urllib.request, urllib.error
from pathlib import Path

API = "https://api.opendota.com/api"
LEAGUE = 19102              # BLAST SLAM VIII (OpenDota). Slam IX = 20208
POLL = 120                  # секунд между проходами
PARSE_WAIT = 30 * 60        # сколько ждать разбора реплея, потом считаем без парс-полей
OUT = Path(__file__).with_name("slam_live.json")
STATE = Path(__file__).with_name("slam_live_state.json")

# Правила очков — те же, что в прототипе
SC = dict(kills=.3, deaths=-.3, assists=.15, last_hits=.003, gold_per_min=.002,
          towers_killed=1, roshans_killed=1, firstblood_claimed=4, stuns=.05,
          obs_placed=.5, camps_stacked=.5)
WIN = 3
COEF = {"carry": 1.14, "mid": 1.08, "off": 1.07, "soft": 1.02, "hard": .96}
PARSED_FIELDS = ("stuns", "obs_placed", "camps_stacked", "towers_killed", "roshans_killed", "firstblood_claimed")

ROLES = ["carry", "mid", "off", "soft", "hard"]
ROSTERS = {  # позиции 1–5; сверять перед каждым турниром
    "Team Spirit": ["Yatoro", "Larl", "Batyuk", "not me", "rue"],
    "PARIVISION": ["Satanic", "No[o]ne-", "Noticed", "9Class", "Dukalis"],
    "Xtreme Gaming": ["Ame", "Moon", "Zeal", "XinQ", "BoBoKa"],
    "BetBoom Team": ["Kiritych~", "Save-", "MieRo", "swedenstrong", "Kataomi`"],
    "Team Yandex": ["watson", "CHIRA_JUNIOR", "ATF", "Saksa", "Malady"],
    "Aurora Gaming": ["skiter", "Mikoto", "Ws", "Mira", "kaori"],
    "Team Liquid": ["miCKe", "MidOne", "Wisper", "Boxi", "tOfu"],
    "1w Team": ["Pure", "bzm", "33", "Ari", "Whitemon"],
    "Natus Vincere": ["gotthejuice", "Niku", "pma", "daze", "Riddys"],
    "MOUZ": ["423", "Supream^", "BOOM", "mrls", "MoOz"],
    "OG": ["Natsumi", "Topson", "SSS", "OneJey", "skem"],
    "LGD Gaming": ["Wits", "SumaiL-", "Davai", "Thiolicor", "Sneyking"],
    "GamerLegion": ["Timado", "RCY", "Fayde", "Bignum", "Speeed"],
    "Level UP": ["WoE", "Ainkrad", "bb3px", "queezy", "Htrd"],
    "Yakult Brothers": ["Lou", "Emo", "Beyond", "kaka", "天命"],
    "Team Nemesis": ["JaCkky", "Ken", "Jabz", "Jhocam", "NARMAN"],
}
# account_id -> ник, если автоматически не сопоставилось (смотри "unknown" в slam_live.json)
MANUAL_IDS = {321580662: "Yatoro", 106305042: "Larl", 140835095: "Batyuk", 218231587: "not me", 847565596: "rue"}

def get(path):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path, headers={"User-Agent": "slam-fantasy"}), timeout=60) as r:
                return json.load(r)
        except Exception as e:
            print(f"  ! {path}: {e}", file=sys.stderr); time.sleep(5 * (i + 1))
    return None

def post(path):
    try:
        urllib.request.urlopen(urllib.request.Request(API + path, data=b"", method="POST", headers={"User-Agent": "slam-fantasy"}), timeout=30)
    except Exception as e:
        print(f"  ! POST {path}: {e}", file=sys.stderr)

def norm(s): return "".join(c for c in (s or "").lower() if c.isalnum() or ord(c) > 127)

PLAYER = {norm(n): (team, role, n) for team, ns in ROSTERS.items() for role, n in zip(ROLES, ns)}

def build_id_map():
    ids = {aid: n for aid, n in MANUAL_IDS.items()}
    pros = get("/proPlayers") or []
    for p in pros:
        k = norm(p.get("name"))
        if k in PLAYER and p["account_id"] not in ids:
            ids[p["account_id"]] = PLAYER[k][2]
    return ids

def score(p, won):
    raw = sum((p.get(k) or 0) * v for k, v in SC.items()) + (WIN if won else 0)
    return raw

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--once", action="store_true"); ap.add_argument("--league", type=int, default=LEAGUE)
    a = ap.parse_args()
    state = json.loads(STATE.read_text()) if STATE.exists() else {"maps": {}, "requested": {}}
    ids = build_id_map()
    print(f"Сопоставлено игроков: {len(set(ids.values()))} из 80")
    while True:
        lst = get(f"/leagues/{a.league}/matches") or []
        for m in sorted(lst, key=lambda x: x["start_time"]):
            mid = str(m["match_id"])
            if mid in state["maps"] and state["maps"][mid]["final"]:
                continue
            d = get(f"/matches/{mid}")
            if not d or "players" not in d:
                continue
            parsed = d.get("version") is not None
            age = time.time() - (d["start_time"] + d["duration"])
            if not parsed and mid not in state["requested"]:
                post(f"/request/{mid}"); state["requested"][mid] = time.time()
                print(f"  реплей {mid} отправлен на разбор")
            final = parsed or age > PARSE_WAIT
            rows = []
            for p in d["players"]:
                nick = ids.get(p.get("account_id")) or (PLAYER.get(norm(p.get("name")), (None, None, None))[2])
                won = p["isRadiant"] == d["radiant_win"]
                raw = score(p, won)
                team, role = (PLAYER[norm(nick)][:2] if nick else (None, None))
                rows.append({"account_id": p.get("account_id"), "nick": nick, "name_in_match": p.get("name") or p.get("personaname"),
                             "team": team, "role": role, "won": won,
                             "stats": {k: p.get(k) for k in list(SC) + ["hero_id"]},
                             "raw": round(raw, 2), "pts": round(raw * COEF[role], 1) if role else None})
            state["maps"][mid] = {"match_id": d["match_id"], "start_time": d["start_time"], "duration": d["duration"],
                                  "radiant": d.get("radiant_name"), "dire": d.get("dire_name"), "radiant_win": d["radiant_win"],
                                  "parsed": parsed, "final": final, "players": rows}
            print(f"  карта {mid}: {d.get('radiant_name')} vs {d.get('dire_name')} · {'разобрана' if parsed else 'ждём разбор'}")
        # сводка по игрокам
        tot = {}
        unknown = set()
        for mp in state["maps"].values():
            for r in mp["players"]:
                if not r["nick"]:
                    unknown.add(f'{r["account_id"]} ({r["name_in_match"]})'); continue
                t = tot.setdefault(r["nick"], {"team": r["team"], "role": r["role"], "maps": 0, "pts": 0.0})
                t["maps"] += 1; t["pts"] = round(t["pts"] + (r["pts"] or 0), 1)
        STATE.write_text(json.dumps(state, ensure_ascii=False))
        OUT.write_text(json.dumps({"league": a.league, "updated": int(time.time()), "players": tot,
                                   "maps": list(state["maps"].values()), "unknown": sorted(unknown)}, ensure_ascii=False, indent=1))
        print(f"{time.strftime('%H:%M:%S')} карт: {len(state['maps'])}, игроков с очками: {len(tot)}, не сопоставлено: {len(unknown)} → {OUT.name}")
        if a.once: break
        time.sleep(POLL)

if __name__ == "__main__":
    main()
