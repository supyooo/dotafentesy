"""Проверка целостности prototype/data/*.json — запускать после любой правки данных (руками или скриптом).

python scripts/validate_data.py
Код выхода 1, если есть ошибки; предупреждения (нет account_id, нет фото) выхода не ломают.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROTO = ROOT / "prototype"
DATA = PROTO / "data"
ROLES = ["carry", "mid", "off", "soft", "hard"]

errors, warnings = [], []


def load(name):
    try:
        return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        errors.append(f"{name}.json: {e}")
        return None


teams, players, rosters, tours = (load(n) for n in ("teams", "players", "rosters", "tournaments"))
if errors:
    print("\n".join("ОШИБКА  " + e for e in errors))
    sys.exit(1)


def unique(items, key, where):
    seen = set()
    for it in items:
        v = it.get(key)
        if v in seen:
            errors.append(f"{where}: повторяется {key}={v!r}")
        seen.add(v)


unique(teams, "id", "teams.json")
unique(players, "id", "players.json")
unique([p for p in players if p.get("account_id")], "account_id", "players.json")
team_ids = {t["id"] for t in teams}
for t in teams:
    if t.get("logo") and not (PROTO / t["logo"]).is_file():
        errors.append(f"teams.json: {t['name']} — файл логотипа не найден: {t['logo']}")
    elif not t.get("logo"):
        warnings.append(f"teams.json: {t['name']} — нет логотипа")
player_ids = {p["id"] for p in players}

for p in players:
    if not p.get("account_id"):
        warnings.append(f"players.json: {p['nick']} — нет account_id")
    photo = p.get("photo")
    if not photo:
        warnings.append(f"players.json: {p['nick']} — нет фото")
    elif not (PROTO / photo).is_file():
        errors.append(f"players.json: {p['nick']} — файл фото не найден: {photo}")

roster_ids = set()
for r in rosters:
    rid = r["id"]
    roster_ids.add(rid)
    used = {}
    for e in r["teams"]:
        if e["team"] not in team_ids:
            errors.append(f"rosters.json/{rid}: неизвестная команда {e['team']!r}")
        if e.get("status") not in r.get("statuses", {}):
            errors.append(f"rosters.json/{rid}: {e['team']} — неизвестный статус {e.get('status')!r}")
        if sorted(e["players"]) != sorted(ROLES):
            errors.append(f"rosters.json/{rid}: {e['team']} — позиции должны быть ровно {ROLES}")
        for role, pid in e["players"].items():
            if pid not in player_ids:
                errors.append(f"rosters.json/{rid}: {e['team']}/{role} — неизвестный игрок {pid!r}")
            if pid in used:
                errors.append(f"rosters.json/{rid}: {pid} заявлен и за {used[pid]}, и за {e['team']}")
            used[pid] = e["team"]
    in_roster = {e["team"] for e in r["teams"]}
    grouped = [t for g in r.get("groups", {}).values() for t in g]
    if grouped and sorted(grouped) != sorted(in_roster):
        errors.append(f"rosters.json/{rid}: группы не совпадают с командами состава")

unique(tours["tournaments"], "id", "tournaments.json")
for t in tours["tournaments"]:
    if t.get("roster") not in roster_ids:
        errors.append(f"tournaments.json/{t['id']}: неизвестный состав {t.get('roster')!r}")
    if t.get("format") not in tours.get("formats", {}):
        errors.append(f"tournaments.json/{t['id']}: неизвестный формат {t.get('format')!r}")

for w in warnings:
    print("внимание " + w)
for e in errors:
    print("ОШИБКА  " + e)
print(f"\nкоманд {len(teams)}, игроков {len(players)}, составов {len(rosters)}, турниров {len(tours['tournaments'])}; "
      f"ошибок {len(errors)}, предупреждений {len(warnings)}")
sys.exit(1 if errors else 0)
