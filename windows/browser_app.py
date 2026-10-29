"""Local-only PC shell settings. Never proxies requests or sends CNC commands."""
import argparse
import hmac
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 19758
ORIGIN = f"http://127.0.0.1:{PORT}"
ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "MainsailCNCPendant"
CONFIG = DATA / "pc-settings.json"
DEFAULTS = dict(address="", layout="compact", fit=True, awake=True, fullscreen=False)


def address(raw):
    value = str(raw).strip()
    if not value or any(ord(c) < 33 for c in value) or any(c in value for c in '\\"'):
        raise ValueError("Enter the Pi's HTTP or HTTPS address.")
    if "://" not in value:
        value = "http://" + value
    uri = urllib.parse.urlsplit(value)
    if uri.scheme not in ("http", "https") or not uri.hostname or uri.username is not None or uri.password is not None or uri.port == 0:
        raise ValueError("Use an HTTP or HTTPS machine address without credentials.")
    # Accessing .port also rejects invalid/out-of-range ports.
    port = uri.port
    host = uri.hostname.lower()
    if ":" in host:
        host = "[" + host + "]"
    return f"{uri.scheme}://{host}" + (f":{port}" if port else "")


def validate(raw):
    if type(raw) is not dict or set(raw) != set(DEFAULTS):
        raise ValueError("Unknown or missing app setting.")
    result = dict(raw)
    result["address"] = address(raw["address"])
    if raw["layout"] not in ("compact", "expanded"):
        raise ValueError("Choose Compact Pendant or Expanded dashboard.")
    for key in ("fit", "awake", "fullscreen"):
        if type(raw[key]) is not bool:
            raise ValueError("Invalid app option.")
    return result


def read_settings():
    if not CONFIG.exists():
        return dict(DEFAULTS)
    return validate(json.loads(CONFIG.read_text(encoding="utf-8")))


def save_settings(settings):
    settings = validate(settings)
    DATA.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG.with_suffix(".tmp")
    temporary.write_text(json.dumps(settings, indent=2), encoding="utf-8")
    if CONFIG.exists():
        old = CONFIG.read_bytes()
        CONFIG.with_suffix(".previous.json").write_bytes(old)
    os.replace(temporary, CONFIG)
    if read_settings() != settings:
        raise IOError("App settings readback differs.")
    return settings


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, endpoint=("127.0.0.1", PORT)):
        super().__init__(endpoint, Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"
        self.token = secrets.token_urlsafe(32)
        self.lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, body, content_type="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def host_ok(self):
        return self.headers.get("Host") == urllib.parse.urlsplit(self.server.origin).netloc

    def do_GET(self):
        if not self.host_ok():
            return self.reply(403, {"error": "Local host required."})
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/settings":
            try:
                return self.reply(200, {"app": "mainsail-cnc-pc-v1", "settings": read_settings(), "token": self.server.token})
            except Exception as error:
                return self.reply(200, {"app": "mainsail-cnc-pc-v1", "settings": dict(DEFAULTS), "token": self.server.token, "error": str(error)})
        assets = {"/": ("browser-app.html", "text/html; charset=utf-8"), "/app.js": ("browser-app.js", "application/javascript; charset=utf-8"), "/icon.svg": ("icon.svg", "image/svg+xml")}
        if path not in assets:
            return self.reply(404, {"error": "Not found."})
        name, kind = assets[path]
        return self.reply(200, (ROOT / name).read_bytes(), kind)

    def do_POST(self):
        if not self.host_ok() or self.headers.get("Origin") != self.server.origin or not hmac.compare_digest(self.headers.get("X-PC-App-Token", ""), self.server.token):
            return self.reply(403, {"error": "Open settings from the PC app."})
        if self.path != "/api/settings":
            return self.reply(404, {"error": "Not found."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("Invalid settings size.")
            raw = json.loads(self.rfile.read(length))
            with self.server.lock:
                result = save_settings(raw)
            return self.reply(200, {"settings": result})
        except (ValueError, OSError) as error:
            return self.reply(400, {"error": str(error)})


def browser():
    relative = Path("BraveSoftware/Brave-Browser/Application/brave.exe")
    for base in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
        if base and (Path(base) / relative).is_file():
            return Path(base) / relative
    raise FileNotFoundError("Brave is not installed.")


def launch(settings):
    args = [str(browser()), "--user-data-dir=" + str(DATA / "BrowserProfile" / "Brave"), "--no-first-run", "--no-default-browser-check", "--app=" + ORIGIN]
    args += ["--start-fullscreen"] if settings.get("fullscreen") else ["--window-size=1200,900"]
    subprocess.Popen(args, close_fds=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve-only", action="store_true")
    args = parser.parse_args()
    try:
        server = Server()
    except OSError:
        with urllib.request.urlopen(ORIGIN + "/api/settings", timeout=3) as response:
            existing = json.load(response)
        if existing.get("app") != "mainsail-cnc-pc-v1":
            raise RuntimeError("The PC app port is occupied by another service.")
        if not args.serve_only:
            launch(existing["settings"])
        return
    # Taskbar branding is limited to the two dedicated machine Brave profiles.
    try:
        import sys
        sys.path.insert(0, str(Path(os.environ["LOCALAPPDATA"]) / "Programs/MachineControls"))
        import taskbar_identity
        taskbar_identity.start()
    except Exception:
        pass  # Branding failure must never prevent access to machine controls.
    if not args.serve_only:
        try:
            settings = read_settings()
        except (ValueError, OSError):
            settings = dict(DEFAULTS)
        launch(settings)
    server.serve_forever()


if __name__ == "__main__":
    main()
