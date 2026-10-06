# Первая версия Drizzle-схемы из ER-модели (docs/11): docs/db/schema.py → packages/db/src/schema/<домен>.ts
# Запуск: python packages/db/scripts/gen_drizzle.py
# После генерации схема правится руками; перегенерация затирает файлы — сначала сверить diff.
# Что добавляется сверх DBML (docs/09 «Принципы»): identity для id, CHECK для перечислений и диапазонов,
# частичный индекс series(status) WHERE live, UNIQUE (tenant_id, lower(nickname)), DEFAULT now() для служебных времён.
# Мини-лиги (social) не генерируются — решение 06.10.2026. raw_payloads — вручную (партиционирование), см. src/schema-manual.
import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "docs" / "db"))
import schema as S  # noqa: E402

OUT = ROOT / "packages" / "db" / "src" / "schema"
SKIP_DOMAINS = {"social"}
MANUAL_TABLES = {"raw_payloads"}
FILE = {"catalog": "catalog", "tournament": "tournament", "ingest": "ingest", "fantasy": "fantasy", "users": "users",
        "lineups": "lineups", "pickem": "pickem", "season": "season", "engagement": "engagement", "b2b": "b2b"}
NOW_DEFAULT = {"created_at", "updated_at", "fetched_at", "computed_at", "joined_at", "locked_at", "earned_at", "awarded_at"}

def camel(s): p = s.split("_"); return p[0] + "".join(x.title() for x in p[1:])
def keys(k): return k.split()
def fks(k): return [p[3:] for p in keys(k) if p.startswith("FK>")]

def col_type(n, ty):
    if ty == "bigint": return f'bigint("{n}", {{ mode: "number" }})'
    if ty in ("smallint", "integer", "text", "boolean", "jsonb", "date"):
        return {"date": f'date("{n}", {{ mode: "string" }})'}.get(ty, f'{ty}("{n}")')
    if ty == "timestamptz": return f'timestamp("{n}", {{ withTimezone: true }})'
    if ty == "bytea": return f'bytea("{n}")'
    if ty == "text[]": return f'text("{n}").array()'
    m = re.match(r"char\((\d+)\)", ty)
    if m: return f'char("{n}", {{ length: {m.group(1)} }})'
    m = re.match(r"numeric\((\d+),(\d+)\)", ty)
    if m: return f'numeric("{n}", {{ precision: {m.group(1)}, scale: {m.group(2)} }})'
    raise ValueError(ty)

def enum_values(ty, note):
    """'a | b | c' в комментарии → значения перечисления. Открытые списки (с «…») и прочие примечания — None."""
    if not note or "…" in note or "|" not in note: return None
    vals = [re.match(r"[\w]+", x.strip()) for x in note.split("|")]
    if not all(vals): return None
    vals = [v.group(0) for v in vals]
    if ty == "text" and all(re.fullmatch(r"[a-z_]+", v) for v in vals): return vals
    if ty == "smallint" and all(v.isdigit() for v in vals): return vals
    return None

def range_values(ty, note):
    m = ty == "smallint" and note and re.match(r"^(\d+)\s*[–…-]\s*(\d+)", note)
    return (m.group(1), m.group(2)) if m else None

all_tables = {t["name"]: d["code"] for d in S.D for t in d["tables"]}
for d in S.D:
    if d["code"] in SKIP_DOMAINS: continue
    imports_pg, cross, body = set(["pgTable"]), {}, []
    uses_sql = False
    for t in d["tables"]:
        name = t["name"]
        if name in MANUAL_TABLES: continue
        pks = [n for (n, ty, k, _) in t["cols"] if "PK" in keys(k)]
        lines, checks, extras = [], [], []
        for (n, ty, k, c) in t["cols"]:
            expr = col_type(n, ty)
            imports_pg.add(re.match(r"\w+", expr).group(0))
            ks = keys(k)
            if "PK" in ks and len(pks) == 1:
                expr += ".primaryKey()"
                if n == "id" and ty == "bigint": expr += ".generatedByDefaultAsIdentity()"
            if "NN" in ks and "PK" not in ks: expr += ".notNull()"
            if "UQ" in ks: expr += ".unique()"
            if ty == "timestamptz" and n in NOW_DEFAULT and "NN" in ks: expr += ".defaultNow()"
            if n in ("score_a", "score_b"): expr += ".default(0)"
            for f in fks(k):
                tgt = camel(f)
                if all_tables[f] != d["code"]: cross.setdefault(FILE[all_tables[f]], set()).add(tgt)
                if f == name:
                    imports_pg.add("type AnyPgColumn"); expr += f".references((): AnyPgColumn => {tgt}.id)"
                else: expr += f".references(() => {tgt}.id)"
            lines.append(f"    {camel(n)}: {expr},")
            ev, rv = enum_values(ty, c), range_values(ty, c)
            if ev:
                vals = ", ".join(f"'{v}'" if ty == "text" else v for v in ev)
                checks.append(f'check("{name}_{n}_check", sql`${{t.{camel(n)}}} in ({vals})`)')
            elif rv:
                checks.append(f'check("{name}_{n}_check", sql`${{t.{camel(n)}}} between {rv[0]} and {rv[1]}`)')
        if len(pks) > 1:
            imports_pg.add("primaryKey")
            extras.append(f'primaryKey({{ columns: [{", ".join("t." + camel(p) for p in pks)}] }})')
        for x in t.get("extra", []):
            m = re.match(r"(UNIQUE|INDEX) \((.*)\)(?: WHERE (\w+ = '\w+'))?(?: — .*)?$", x)
            if not m: continue  # PARTITION и пояснения — не индексы
            cols_raw, where = m.group(2), m.group(3)
            kind = "uniqueIndex" if m.group(1) == "UNIQUE" else "index"
            imports_pg.add(kind)
            parts = [p.strip() for p in re.split(r",\s*(?![^(]*\))", cols_raw)]
            def col_expr(p):
                lm = re.fullmatch(r"lower\((\w+)\)", p)
                if lm: return f"sql`lower(${{t.{camel(lm.group(1))}}})`"
                dm = re.fullmatch(r"(\w+) DESC", p)
                if dm: return f"t.{camel(dm.group(1))}.desc()"
                return f"t.{camel(p)}"
            iname = f"{name}_{'_'.join(re.sub(r'[^a-z_]', '', p.replace(' DESC', '').replace('lower(', 'lower_')) for p in parts)}_{'uq' if kind == 'uniqueIndex' else 'idx'}"
            e = f'{kind}("{iname}").on({", ".join(col_expr(p) for p in parts)})'
            if where:
                wm = re.fullmatch(r"(\w+) = '(\w+)'", where)
                e += f".where(sql`${{t.{camel(wm.group(1))}}} = '{wm.group(2)}'`)"
            extras.append(e)
        if checks: imports_pg.add("check")
        extras += checks
        if extras or checks: uses_sql = uses_sql or bool(checks) or any("sql`" in e for e in extras)
        head = f'/** {t["desc"]} */\nexport const {camel(name)} = pgTable("{name}", {{\n' + "\n".join(lines) + "\n}"
        if extras: head += ", (t) => [\n" + "".join(f"  {e},\n" for e in extras) + "]"
        body.append(head + ");\n")
    if not body: continue
    pg_imports = sorted(imports_pg - {"type AnyPgColumn", "bytea"}) + (["type AnyPgColumn"] if "type AnyPgColumn" in imports_pg else [])
    src = [f"// {d['name']}. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.",
           f'import {{ {", ".join(pg_imports)} }} from "drizzle-orm/pg-core";']
    if uses_sql: src.append('import { sql } from "drizzle-orm";')
    if "bytea" in imports_pg: src.append('import { bytea } from "./types.js";')
    for f, names in sorted(cross.items()):
        if f != FILE[d["code"]]: src.append(f'import {{ {", ".join(sorted(names))} }} from "./{f}.js";')
    (OUT / f"{FILE[d['code']]}.ts").write_text("\n".join(src) + "\n\n" + "\n".join(body), encoding="utf-8")
    print(d["code"], len(body))
