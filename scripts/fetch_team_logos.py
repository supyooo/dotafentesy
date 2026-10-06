"""Логотипы команд из Steam (команды сами загружают их в Dota 2) через OpenDota /teams/{steam_team_id}.

python scripts/fetch_team_logos.py            — скачать/обновить prototype/teams/<id>.webp и поле logo в teams.json
python scripts/fetch_team_logos.py --skip 1w  — не брать логотип для указанных команд (через запятую)

steam_team_id в teams.json проверены по составам в матчах BLAST Slam VIII (OpenDota, 30.09–02.10.2026).
Нужен Pillow (pip install pillow) — переводим PNG в webp 256×256.
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "prototype" / "data"
OUT = ROOT / "prototype" / "teams"
UA = {"User-Agent": "dota-fantasy-prototype"}


def get(url, raw=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read() if raw else json.load(r)


def main(skip):
    teams = json.loads((DATA / "teams.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    for t in teams:
        sid = t.get("steam_team_id")
        if t["id"] in skip or not sid:
            print(f"{t['name']:<16} пропуск" + ("" if sid else " (нет steam_team_id)"))
            t.pop("logo", None)
            continue
        info = get(f"https://api.opendota.com/api/teams/{sid}")
        url = info.get("logo_url")
        if not url:
            print(f"{t['name']:<16} нет логотипа в Steam")
            t.pop("logo", None)
            continue
        im = Image.open(io.BytesIO(get(url, raw=True))).convert("RGBA")
        im.thumbnail((256, 256))
        path = OUT / f"{t['id']}.webp"
        im.save(path, "WEBP", quality=90, method=6)
        t["logo"] = f"teams/{t['id']}.webp"
        print(f"{t['name']:<16} {sid:<9} «{info.get('name')}» → {path.name} {im.size}")
    (DATA / "teams.json").write_text(json.dumps(teams, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(set(a[a.index("--skip") + 1].split(",")) if "--skip" in a else set())
