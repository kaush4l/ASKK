#!/usr/bin/env python3
"""What scripts/shots.sh captures, and the page that shows it.

    plan.py page <url> <terminal box id>   the plan for scripts/shots/page.mjs (the full app)
    plan.py tab <url>                      the plan for the tab build
    plan.py frames <SHOW=1 output> <dir>   the full-screen terminal's screens: one .txt and
                                           one .html each (the .html is shot like a page)
    plan.py index <dir>                    index.html: every frame, by type and screen

Every frame is named <type>--<screen>--<size>-<theme>[-<setting>], so a type's frames sit
together and one screen can be compared across sizes and themes.
"""
import html
import json
import os
import re
import sys

SIZES = [("phone", 375, 812), ("tablet", 900, 1100), ("wide", 1440, 900)]
THEMES = [("dark", True), ("light", False)]
MOD_B = {"key": "b", "code": "KeyB", "windowsVirtualKeyCode": 66, "modifiers": 4}
MOD_K = {"key": "k", "code": "KeyK", "windowsVirtualKeyCode": 75, "modifiers": 4}
SHOW_IDLE = "const b = [...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Show the')); if (b) b.click(); return !!b;"


def page(url, terminal):
    screens = [
        ("canvas", "/", {}),
        ("canvas-all", "/", {"after": SHOW_IDLE}),
        ("pill", "/", {"keys": [MOD_B]}),
        ("palette", "/", {"keys": [MOD_K]}),
        ("engine", "/#engine:askk/developer", {}),
        ("settings", "/settings", {}),
    ]
    if terminal:
        screens.append(("terminal", f"/#{terminal}", {}))
    plan = []
    for screen, path, extra in screens:
        for size, w, h in SIZES:
            for theme, dark in THEMES:
                plan.append({"name": f"web--{screen}--{size}-{theme}", "url": url + path, "width": w, "height": h, "dark": dark, "wait": 3000, **extra})
    # What a person can ask the system for: less motion, no see-through glass, more contrast.
    for setting, media, value in [("reduced-motion", "prefers-reduced-motion", "reduce"), ("reduced-transparency", "prefers-reduced-transparency", "reduce"), ("more-contrast", "prefers-contrast", "more")]:
        plan.append({"name": f"web--canvas-all--wide-dark-{setting}", "url": url + "/", "width": 1440, "height": 900, "dark": True, "wait": 3000, "after": SHOW_IDLE, "media": [{"name": media, "value": value}]})
    return plan


def tab(url):
    return [{"name": f"tab--start--{size}-{theme}", "url": url, "width": w, "height": h, "dark": dark, "wait": 6000} for size, w, h in SIZES for theme, dark in THEMES]


def frames(show, out):
    """Split SHOW=1 output of scripts/terminals/tui.py into one file per screen."""
    text = open(show, encoding="utf-8", errors="replace").read()
    os.makedirs(out, exist_ok=True)
    made = []
    for n, m in enumerate(re.finditer(r"---- the screen after: (.*?)\n(.*?)\n----\n", text, re.S)):
        step = re.sub(r"[^a-z0-9]+", "-", m.group(1).lower()).strip("-")[:40]
        name = f"terminal--{n:02d}-{step}--full-dark"
        with open(os.path.join(out, name + ".txt"), "w") as f:
            f.write(m.group(2) + "\n")
        page = f"""<!doctype html><meta charset="utf-8"><title>{html.escape(m.group(1))}</title>
<style>body{{margin:0;background:#101114;color:#e6e6e6}}pre{{margin:0;padding:12px;font:13px/1.25 ui-monospace,Menlo,monospace;white-space:pre}}</style>
<pre>{html.escape(m.group(2))}</pre>"""
        with open(os.path.join(out, name + ".html"), "w") as f:
            f.write(page)
        made.append({"name": name, "url": "file://" + os.path.abspath(os.path.join(out, name + ".html")), "width": 1180, "height": 700, "dark": True, "wait": 300})
    return made


def index(out):
    shots = sorted(f for f in os.listdir(out) if f.endswith((".png", ".txt")) and "--" in f)
    by = {}
    for f in shots:
        kind, screen, _ = f.rsplit(".", 1)[0].split("--", 2)
        by.setdefault(kind, {}).setdefault(screen, []).append(f)
    parts = ["<!doctype html><meta charset='utf-8'><title>askk screens</title>",
             "<style>body{font:14px system-ui;margin:24px;background:#f4f4f6;color:#111}h2{margin-top:40px}h3{margin:20px 0 8px;font-weight:600}"
             ".row{display:flex;gap:12px;overflow-x:auto;align-items:flex-start}figure{margin:0}figure img{max-height:420px;border:1px solid #ccc;border-radius:6px;background:#fff}"
             "figcaption{font-size:12px;color:#555}pre{background:#101114;color:#e6e6e6;padding:8px;font-size:11px;max-height:420px;overflow:auto}</style>",
             "<h1>askk screens</h1><p>Made by <code>scripts/shots.sh</code>, one section per build type, each screen at every size and theme.</p>",
             "<p>" + " · ".join(f"<a href='#{k}'>{k}</a>" for k in sorted(by)) + "</p>"]
    for kind in sorted(by):
        parts.append(f"<h2 id='{kind}'>{kind}</h2>")
        for screen, files in by[kind].items():
            parts.append(f"<h3>{html.escape(screen)}</h3><div class='row'>")
            for f in files:
                cap = html.escape(f.rsplit("--", 1)[-1].rsplit(".", 1)[0])
                if f.endswith(".png"):
                    parts.append(f"<figure><a href='{f}'><img src='{f}' loading='lazy' alt='{kind} {screen} {cap}'></a><figcaption>{cap}</figcaption></figure>")
                elif not os.path.exists(os.path.join(out, f[:-4] + ".png")):
                    parts.append(f"<figure><pre>{html.escape(open(os.path.join(out, f)).read())}</pre><figcaption>{cap}</figcaption></figure>")
            parts.append("</div>")
    with open(os.path.join(out, "index.html"), "w") as f:
        f.write("\n".join(parts))
    return sum(len(v) for k in by.values() for v in k.values())


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "page":
        print(json.dumps(page(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")))
    elif what == "tab":
        print(json.dumps(tab(sys.argv[2])))
    elif what == "frames":
        print(json.dumps(frames(sys.argv[2], sys.argv[3])))
    elif what == "index":
        print(index(sys.argv[2]))
