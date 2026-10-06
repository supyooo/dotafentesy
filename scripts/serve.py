"""Локальный сервер для прототипа без кэширования: правки видны после обычного обновления страницы.

Запуск из корня проекта:
  python scripts/serve.py [порт]            — разработка: весь проект, только localhost
  python scripts/serve.py --share [порт]    — для показа: только prototype/, вход по паролю, noindex
  python scripts/serve.py --share --open [порт] — то же без пароля (временно, по решению автора)

В режиме --share логин «guest», пароль берётся из переменной DF_SHARE_PASSWORD, иначе генерируется
и сохраняется в .share_password в корне (файл в .gitignore). Внешний доступ (туннель) этот скрипт не открывает.
"""
import base64
import hmac
import os
import secrets
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
USER = "guest"


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class ShareHandler(NoCacheHandler):
    expected = ""  # "Basic <base64>" — задаётся при запуске

    def end_headers(self):
        self.send_header("X-Robots-Tag", "noindex, nofollow")
        super().end_headers()

    def _authorized(self):
        if self.expected is None:  # --open: без пароля
            return True
        return hmac.compare_digest(self.headers.get("Authorization", ""), self.expected)

    def _deny(self):
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Dota Fantasy", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write("Нужен пароль".encode("utf-8"))

    def do_GET(self):
        if self._authorized():
            super().do_GET()
        else:
            self._deny()

    def do_HEAD(self):
        if self._authorized():
            super().do_HEAD()
        else:
            self._deny()


def share_password():
    pw = os.environ.get("DF_SHARE_PASSWORD")
    if pw:
        return pw
    f = ROOT / ".share_password"
    if f.is_file():
        return f.read_text(encoding="utf-8").strip()
    pw = secrets.token_urlsafe(9)
    f.write_text(pw + "\n", encoding="utf-8")
    return pw


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a not in ("--share", "--open")]
    share = "--share" in sys.argv
    port = int(args[0]) if args else 8000
    if share:
        if "--open" in sys.argv:
            ShareHandler.expected = None
            mode = "БЕЗ пароля"
        else:
            ShareHandler.expected = "Basic " + base64.b64encode(f"{USER}:{share_password()}".encode()).decode()
            mode = f"логин {USER}, пароль в .share_password"
        handler = partial(ShareHandler, directory=str(ROOT / "prototype"))
        print(f"http://localhost:{port}  (режим показа: только prototype/, {mode})", flush=True)
    else:
        handler = partial(NoCacheHandler, directory=str(ROOT))
        print(f"http://localhost:{port}", flush=True)
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        httpd.serve_forever()
