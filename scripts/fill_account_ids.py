"""Сопоставление игроков prototype/data/players.json с Steam account_id по OpenDota /proPlayers.

python scripts/fill_account_ids.py                  — только отчёт
python scripts/fill_account_ids.py --write          — записать уверенные совпадения в players.json
python scripts/fill_account_ids.py --league 19102   — плюс сверка с реально сыгранными картами лиги (BLAST Slam VIII)

Уверенное совпадение = ник совпал (без учёта регистра и спецсимволов) И команда та же, что в нашем составе.
Команду берём из /proPlayers (там она бывает устаревшей) и, с --league, из составов в сыгранных матчах лиги — это надёжнее.
Всё остальное (тёзки, игрок числится в другой команде, не найден) — только в отчёт, решать вручную.
Уже заполненные account_id не перезаписываются, но проверяются: если OpenDota считает иначе — будет предупреждение.
С --league отчёт показывает и расхождения составов: кто играл за команду, но не заявлен у нас (замены, стендины).
"""
import json
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "prototype" / "data"
API = "https://api.opendota.com/api"


def get(path):
    req = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "dota-fantasy-prototype"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def league_lineups(league_id):
    """{account_id: {"name", "team"}} по всем сыгранным картам лиги (бесплатный лимит OpenDota ~60 запросов/мин)"""
    seen = {}
    for m in get(f"/leagues/{league_id}/matches"):
        d = get(f"/matches/{m['match_id']}")
        for p in d["players"]:
            side = "radiant" if p["isRadiant"] else "dire"
            team = (d.get(f"{side}_team") or {}).get("name") or m.get(f"{side}_team_name")
            seen[p["account_id"]] = {"name": p.get("name") or p.get("personaname") or "?", "team": team}
        time.sleep(1.1)
    return seen


def norm(s):
    """ник/название для сравнения: регистр, диакритика и спецсимволы не важны; иероглифы сохраняем"""
    s = unicodedata.normalize("NFKD", s or "").lower()
    return "".join(ch for ch in s if ch.isalnum())


def team_keys(team):
    """варианты написания команды: полное имя, тег, имя без слов Team/Gaming/Esports"""
    name = norm(team["name"])
    short = norm(re.sub(r"\b(team|gaming|esports|club)\b", "", team["name"], flags=re.I))
    return {k for k in (name, short, norm(team["tag"])) if k}


def same_team(pro, keys):
    theirs = {norm(pro.get("team_name")), norm(pro.get("team_tag"))} - {""}
    return any(a == b or (len(a) >= 4 and len(b) >= 4 and (a in b or b in a)) for a in theirs for b in keys)


def main(write, league):
    players = json.loads((DATA / "players.json").read_text(encoding="utf-8"))
    teams = {t["id"]: t for t in json.loads((DATA / "teams.json").read_text(encoding="utf-8"))}
    rosters = json.loads((DATA / "rosters.json").read_text(encoding="utf-8"))
    team_of = {pid: e["team"] for r in rosters for e in r["teams"] for pid in e["players"].values()}

    pros = get("/proPlayers")
    lineups = league_lineups(league) if league else {}
    # составы из матчей лиги идут первыми: их команда актуальнее, чем в /proPlayers
    cands_all = [{"account_id": a, "name": v["name"], "team_name": v["team"], "src": "матчи лиги"} for a, v in lineups.items()]
    cands_all += [dict(pro, src="proPlayers") for pro in pros]
    by_nick = {}
    for c in cands_all:
        by_nick.setdefault(norm(c.get("name")), []).append(c)
    # один игрок может прийти из обоих источников — не считаем это тёзками
    for k, cs in by_nick.items():
        uniq = {}
        for c in cs:
            uniq.setdefault(c["account_id"], c)
        by_nick[k] = list(uniq.values())

    found, review, missing, conflicts = [], [], [], []
    for p in players:
        if p["id"] not in team_of:  # сейчас ни в одном составе (ушёл из команды)
            continue
        team = teams[team_of[p["id"]]]
        keys = team_keys(team)
        # aliases — текущие игровые ники, если игрок переименовался (darkniA = Ainkrad и т. п.)
        cands = [c for n in [p["nick"], *p.get("aliases", [])] for c in by_nick.get(norm(n), [])]
        hits = [c for c in cands if same_team(c, keys)]
        label = f"{p['nick']} ({team['name']})"
        if p.get("account_id"):
            ids = {c["account_id"] for c in hits}
            if hits and p["account_id"] not in ids:
                conflicts.append(f"{label}: у нас {p['account_id']}, OpenDota: {sorted(ids)}")
            continue
        if len(hits) == 1:
            found.append((p, hits[0]))
        elif len(hits) > 1:
            review.append(f"{label}: несколько в этой команде → " + ", ".join(f"{c['account_id']} {c['name']}" for c in hits))
        elif cands:
            recent = sorted(cands, key=lambda c: c.get("last_match_time") or "", reverse=True)[:3]
            review.append(f"{label}: ник есть, команда другая → " + "; ".join(
                f"{c['account_id']} «{c['name']}» в {c.get('team_name') or '—'} (посл. матч {(c.get('last_match_time') or '—')[:10]})"
                for c in recent))
        else:
            missing.append(label)

    # расхождения составов: играл за нашу команду в лиге, но у нас не заявлен
    extra = []
    ours = {p.get("account_id") for p in players} | {c["account_id"] for _, c in found}
    for acc, v in lineups.items():
        if acc in ours:
            continue
        for tid, t in teams.items():
            if same_team({"team_name": v["team"]}, team_keys(t)):
                extra.append(f"{t['name']}: играл {acc} «{v['name']}» — нет в нашем составе (замена/стендин?)")

    print(f"OpenDota: {len(pros)} про-игроков" + (f", в матчах лиги {league}: {len(lineups)} игроков" if league else "") + "\n")
    print(f"УВЕРЕННО ({len(found)}):")
    for p, c in found:
        print(f"  {p['nick']:<14} → {c['account_id']:<11} «{c['name']}» {c.get('team_name')} [{c['src']}]")
    for title, rows in (("ПРОВЕРИТЬ ВРУЧНУЮ", review), ("НЕ НАЙДЕНЫ", missing), ("КОНФЛИКТЫ с уже заполненными", conflicts),
                        ("РАСХОЖДЕНИЯ СОСТАВОВ по матчам лиги", extra)):
        print(f"\n{title} ({len(rows)}):")
        for row in rows:
            print("  " + row)

    if write and found:
        for p, c in found:
            p["account_id"] = c["account_id"]
        (DATA / "players.json").write_text(json.dumps(players, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"\nЗаписано account_id: {len(found)}. Проверьте: python scripts/validate_data.py")
    elif found:
        print("\nНичего не записано (запустите с --write).")


if __name__ == "__main__":
    args = sys.argv[1:]
    lg = int(args[args.index("--league") + 1]) if "--league" in args else None
    main("--write" in args, lg)
