#!/usr/bin/env python3
"""Drive the full-screen terminal UI once, as a person at a real terminal would.

    python3 tui.py <askk program>          the whole walk below
    python3 tui.py <askk program> again    come back after a detach: what is found
    python3 tui.py <askk program> session  a named session (`--session work`): a layout of its own
    python3 tui.py <askk program> session-again   that session again: its layout is found

`askk terminal` is started in a pseudo-terminal of 140 x 40 (so it draws its full screen,
not lines), in the environment it is called with (the home, the port). The script presses
keys and reads the screen, and says each thing it saw on a line of its own:

    saw: the sidebar lists the boxes
    saw: a pane shows the engine
    saw: a terminal box shows its live screen
    saw: a shell in a new tab ran what was typed
    "shell": 12345                      (the shell's process number, for the caller)
    saw: the wheel looked back up the shell's pane, and typing returned to its end
    saw: copy mode moved up the shell's pane and copied a line (OSC 52)
    saw: a drag over the shell's pane selected and copied (OSC 52)
    saw: a paste reached the program between the marks it asked for
    saw: a split pane beside it, and a click moved the focus
    saw: a click on a box in the sidebar showed it in the pane
    saw: the sidebar groups the boxes by place, with the place's branch and git state
    saw: the help lists the keys in force
    saw: an edit of the keys in settings.json held at once, and back
    saw: navigate mode moved the focus with l, without the prefix, and Esc left it
    saw: a right-click opened the menu of a pane, Esc closed it, and a line of it copied the pane (OSC 52)
    saw: a right-click opened the menus of a tab and of a box in the sidebar
    saw: the tab and the pane were renamed
    saw: copy mode went by words (w e) and copied a word
    saw: copy mode found a text with / and copied it
    saw: copy mode copied a rectangle (ctrl+v)
    saw: a box that came to wait while not shown rang the bell, asked for a desktop notification (OSC 9) and was marked in the sidebar
    saw: the theme is the page's glass in true colour, and light from settings.json at once
    saw: detached with 0

and with `again`:

    saw: attached again, the tabs and splits laid out as they were left
    saw: ctrl+b 1 showed the box that needs the owner first
    saw: the names given to the tab and the pane were kept
    saw: detached with 0

and with `session` / `session-again`:

    saw: a named session opened, its name in the sidebar's head
    saw: the session's own layout was laid out again
    saw: detached with 0

What is copied goes to the outer terminal as OSC 52; the script reads it off what is written.

A full-screen program does not write lines: it places the cursor and writes the cells that
changed. So this script keeps the screen those writes make (`Screen`, below: just enough of
a terminal for that) and looks at its rows. With SHOW=1 it prints the screen after each step.
"""
import base64
import fcntl
import json
import os
import pty
import re
import select
import struct
import sys
import termios
import time
import unicodedata
import urllib.request

COLS, ROWS = 140, 40
# What a terminal is told that is not a letter to show. A cursor placement is read, the
# rest (colours, modes) changes nothing about which letter is in which cell.
CONTROL = re.compile(r"\x1b\[([0-9;?<>=]*)[ -/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78DEHM]")


class Screen:
    """The cells a full-screen program wrote: letters at the places it put the cursor."""

    def __init__(self):
        self.cells = [[" "] * COLS for _ in range(ROWS)]
        self.row = self.col = 0
        self.rest = ""  # the start of a control sequence whose end has not arrived yet

    def write(self, text):
        text = self.rest + text
        self.rest = ""
        at = 0
        while at < len(text):
            ch = text[at]
            if ch == "\x1b":
                found = CONTROL.match(text, at)
                if not found:
                    # Cut off in the middle: wait for the rest (a lone escape is never drawn).
                    self.rest = text[at:]
                    return
                self.control(found.group(1) or "", found.group(2) or "")
                at = found.end()
                continue
            at += 1
            if ch == "\r":
                self.col = 0
            elif ch == "\n":
                self.row = min(self.row + 1, ROWS - 1)
            elif ch >= " ":
                wide = unicodedata.east_asian_width(ch) in ("W", "F")
                if self.row < ROWS and self.col < COLS:
                    self.cells[self.row][self.col] = ch
                    if wide and self.col + 1 < COLS:
                        self.cells[self.row][self.col + 1] = ""
                self.col += 2 if wide else 1

    def control(self, numbers, what):
        if what in "Hf":  # put the cursor at row;column, counted from 1
            parts = [int(n) if n.isdigit() else 1 for n in (numbers.split(";") + ["", ""])[:2]]
            self.row, self.col = parts[0] - 1, parts[1] - 1
        elif (what == "J" and numbers in ("2", "3")) or (what in "hl" and numbers == "?1049"):
            # Wipe the screen; going to the screen of its own and back starts from an empty one.
            self.cells = [[" "] * COLS for _ in range(ROWS)]

    def rows(self):
        return ["".join(r).rstrip() for r in self.cells]


def main():
    program = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else ""
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        args = ["terminal", "--session", "work"] if mode.startswith("session") else ["terminal"]
        os.execv(program, [program] + args)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    screen = Screen()
    decode = __import__("codecs").getincrementaldecoder("utf-8")("replace")
    written = []  # everything the program wrote, for what it put on the clipboard

    def read(seconds):
        """Read what is drawn for a moment. False once the program has ended."""
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([fd], [], [], 0.05)
            if fd in ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    return False
                if not data:
                    return False
                text = decode.decode(data)
                written.append(text)
                screen.write(text)
        return True

    def copied(what, seconds=10, part=False):
        """Wait until the program has put `what` on the clipboard (OSC 52); with `part`, a
        text that holds it."""
        end = time.time() + seconds
        while True:
            found = [base64.b64decode(b).decode("utf-8", "replace") for b in re.findall(r"\x1b\]52;c;([A-Za-z0-9+/=]*)\x07", "".join(written))]
            if what in found or (part and any(what in f for f in found)):
                return
            if time.time() > end or not read(0.1):
                print(f"NOT seen: {what!r} put on the clipboard (OSC 52); what was: {found!r}. The screen:")
                print("\n".join(screen.rows()))
                os.kill(pid, 15)
                sys.exit(1)

    def show(step):
        if os.environ.get("SHOW"):
            print(f"---- the screen after: {step}")
            print("\n".join(screen.rows()))
            print("----")

    def wait(pattern, what, seconds=30):
        """Wait until a row of the screen holds `pattern`; the match, or say so and leave."""
        end = time.time() + seconds
        while True:
            for row in screen.rows():
                found = re.search(pattern, row)
                if found:
                    return found
            if time.time() > end or not read(0.1):
                print(f"NOT seen: {what} (looked for {pattern!r}). The screen:")
                print("\n".join(screen.rows()))
                try:
                    os.kill(pid, 15)
                except OSError:
                    pass
                sys.exit(1)

    def gone(pattern, what, seconds=30):
        """Wait until no row of the screen holds `pattern` any more."""
        end = time.time() + seconds
        while any(re.search(pattern, row) for row in screen.rows()):
            if time.time() > end or not read(0.1):
                print(f"STILL seen: {what} (looked for {pattern!r}). The screen:")
                print("\n".join(screen.rows()))
                os.kill(pid, 15)
                sys.exit(1)

    def press(keys):
        os.write(fd, keys.encode())
        read(0.2)

    def settle(quiet=0.6, seconds=15):
        """Wait until the program has drawn nothing new for `quiet` seconds: a shell that has
        printed its line and its prompt again, so a cursor taken from it is where it rests."""
        end = time.time() + seconds
        while time.time() < end:
            count = len(written)
            if not read(quiet) or len(written) == count:
                return

    def copy_mode():
        """ctrl+b [ on a pane at rest, and wait until copy mode says its keys."""
        settle()
        press("\x02[")
        wait(r"copy · v selects", "the pane in copy mode")

    def leave():
        """ctrl+b q: detach. The program leaves with 0; what it opened is not its business."""
        press("\x02q")
        end = time.time() + 15
        while time.time() < end:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                print(f"saw: detached with {os.waitstatus_to_exitcode(status)}")
                return
            read(0.1)
        print("NOT seen: the terminal UI left after ctrl+b q")
        os.kill(pid, 15)
        sys.exit(1)

    def click(col, row):
        """Press and let go of the left button over a cell (counted from 0)."""
        press(f"\x1b[<0;{col + 1};{row + 1}M\x1b[<0;{col + 1};{row + 1}m")

    def right_click(col, row):
        """Press and let go of the right button over a cell (counted from 0)."""
        press(f"\x1b[<2;{col + 1};{row + 1}M\x1b[<2;{col + 1};{row + 1}m")

    def written_since(mark):
        return "".join(written)[mark:]

    def seen_written(pattern, what, since=0, seconds=15):
        """Wait until what the program wrote (its bytes, not the cells) holds `pattern`."""
        end = time.time() + seconds
        while not re.search(pattern, written_since(since)):
            if time.time() > end or not read(0.1):
                print(f"NOT seen: {what} (looked for {pattern!r} in what was written)")
                os.kill(pid, 15)
                sys.exit(1)

    def ask(name, args):
        """Ask the service over /ask, as another client would."""
        url = f"http://127.0.0.1:{os.environ['PORT']}/ask/{name}"
        req = urllib.request.Request(url, data=json.dumps(args).encode(), headers={"content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read()).get("ok")

    def where(pattern, what):
        """The row and the column at which `pattern` is on the screen."""
        wait(pattern, what)
        for number, row in enumerate(screen.rows()):
            found = re.search(pattern, row)
            if found:
                return number, found.start()

    prefix = "\x02"  # ctrl+b

    if mode == "session":
        wait(r"^ askk · work @", "the session's name in the head of the sidebar")
        print("saw: a named session opened, its name in the sidebar's head")
        press(prefix + "v")
        wait(r"┐┌ ● sh · sh ─", "a split in the session's window")
        press(prefix + "T")
        press("worktab\r")
        wait(r"│ 1 worktab", "the session's tab, named")
        show("a named session")
        leave()
        return
    if mode == "session-again":
        wait(r"│ 1 worktab", "the session's named tab, laid out again")
        wait(r"┐┌ ● sh · sh ─", "and its split")
        print("saw: the session's own layout was laid out again")
        leave()
        return

    if mode == "again":
        # Coming back: the service kept the layout. The tabs are as they were left, the tab in
        # view is the split one (an engine beside a shell), and the shell that was replaced
        # by the engine has a tab of its own at the end.
        wait(r"│ 1 sh -c 'echo hello-  2 sh -c 'echo hello-  3 \S+  4 sh", "the four tabs, the first two on the service's first terminal")
        wait(r"┌ ○ \S+ · engine ─+┐┌ ● mypane \(sh · sh\) ─", "the split tab: the engine beside the second shell, named, as it was left")
        wait(r"laid out again", "the foot saying the layout was laid out again")
        print("saw: attached again, the tabs and splits laid out as they were left")
        show("attached again")
        # ctrl+b 1: the box that needs the owner first (a terminal that works, the oldest).
        press(prefix + "1")
        wait(r"┌ ● (mypane \()?sh -c 'echo hello.* · sh\)? ─", "the service's first terminal in the pane in focus")
        print("saw: ctrl+b 1 showed the box that needs the owner first")
        show("ctrl+b 1")
        wait(r" 3 mytab", "the tab's name, kept with the layout")
        wait(r"┌ ● mypane \(", "the pane's name, kept with the layout")
        print("saw: the names given to the tab and the pane were kept")
        leave()
        return

    # 1. The first screen: the sidebar with every box, and a pane on an engine.
    wait(r"^ boxes", "the sidebar's heading")
    wait(r"^.[○●?!✓·] .* · engine", "an engine as a row of the sidebar")
    wait(r"^.● sh -c 'echo hello", "the terminal the service already holds, as a row of the sidebar, marked as working")
    print("saw: the sidebar lists the boxes")
    wait(r"┌ ○ \S+ · engine ─", "a pane whose frame names an engine and its state")
    wait(r"│> ", "the line to speak into, in that pane")
    wait(r"^ ctrl\+b  then  c tab  v split right", "the foot with the keys")
    wait(r"│ 1 \S+  2 sh -c 'echo hello", "a second tab, for the terminal that already ran")
    print("saw: a pane shows the engine")
    show("the first screen")

    # 2. ctrl+b w: the sidebar. The terminal is working, so it is listed above the idle
    #    engines: up to the top, Enter, and the pane shows its live screen.
    press(prefix + "w")
    wait(r"^ NAVIGATE ", "the foot saying navigate mode")
    press("\x1b[A" * 6)
    press("\r")
    wait(r"│typed by a client", "the terminal's screen in the pane")
    wait(r"┌ ● sh -c 'echo hello.* · sh ─", "the pane's frame naming the terminal's box")
    print("saw: a terminal box shows its live screen")
    show("a terminal box in the pane")

    # 3. ctrl+b c: a new tab with a shell. Typing reaches it, and what it prints is drawn.
    press(prefix + "c")
    wait(r"┌ ● sh · sh ─", "the new pane, with the shell as its box")
    press("echo tui-$((40+2)) shell-$$\r")
    found = wait(r"│tui-42 shell-(\d+)", "what the shell printed for the typed line")
    wait(r" 3 sh( |$)", "the third tab, named after the shell")
    print("saw: a shell in a new tab ran what was typed")
    print(f'"shell": {found.group(1)}')
    show("a shell in a new tab")

    # More rows than the pane has: the wheel looks back up at what scrolled off, and the
    # next key typed returns to the end.
    press("i=1; while [ $i -le 80 ]; do echo line-$i; i=$((i+1)); done\r")
    wait(r"│line-80", "the last of eighty lines")
    for _ in range(4):
        press("\x1b[<64;80;10M")
    wait(r"↑ 12 rows up", "the pane saying how far up it is looked at")
    wait(r"│line-3[0-9]", "lines that had scrolled off the top")
    show("looked back up")
    press("\r")
    gone(r"rows up", "the pane still looked back in after a key was typed")
    wait(r"│line-80", "the end of the shell's screen again")
    print("saw: the wheel looked back up the shell's pane, and typing returned to its end")

    # Copy mode: ctrl+b [ stops the pane; the cursor goes up a row (what was printed), to its
    # start, v selects, $ to its end, y copies; up and up again reaches what scrolled off.
    press("echo copy-me-$((2+3))\r")
    wait(r"│copy-me-5", "what the shell printed to be copied")
    press(prefix + "[")
    wait(r"copy · v selects · esc leaves", "the pane in copy mode, saying its keys")
    show("copy mode")
    press("k0v$y")
    copied("copy-me-5")
    wait(r"copied 9 characters to the clipboard", "the foot saying what was copied")
    press(prefix + "[")
    press("k" * 40)
    wait(r"copy · v selects · esc leaves · ↑ \d+ rows up", "copy mode looking up into what scrolled off")
    show("copy mode, up in the scroll-back")
    press("\x1b")
    gone(r"copy · ", "copy mode after Esc")
    print("saw: copy mode moved up the shell's pane and copied a line (OSC 52)")

    # A drag over the pane selects; letting go copies.
    press("echo drag-me-please\r")
    row, col = where(r"│drag-me-please", "the line to drag over")
    press(f"\x1b[<0;{col + 2};{row + 1}M")
    press(f"\x1b[<32;{col + 2 + 6};{row + 1}M")
    press(f"\x1b[<32;{col + 2 + 13};{row + 1}M")
    show("dragged over a line")
    press(f"\x1b[<0;{col + 2 + 13};{row + 1}m")
    copied("drag-me-please")
    print("saw: a drag over the shell's pane selected and copied (OSC 52)")

    # Bracketed paste: a program that asks for it gets a paste between the marks. `cat -v`
    # shows the marks as ^[[200~ and ^[[201~.
    press("printf '\\033[?2004h'; cat -v\r")
    read(0.5)
    press("\x1b[200~pasted-text\x1b[201~")
    press("\r")
    wait(r"\^\[\[200~pasted-text\^\[\[201~", "the paste between its marks, as cat -v shows them")
    press("\x03")
    press("printf '\\033[?2004l'; echo line-0\r")
    print("saw: a paste reached the program between the marks it asked for")

    # 4. ctrl+b v: a second shell beside the first. A click on the left pane takes the focus
    #    there: what is typed next lands in the first shell, not in the new one.
    press(prefix + "v")
    wait(r"┌ ● sh · sh ─+┐┌ ● sh · sh ─", "two panes side by side, each with a shell")
    row, col = where(r"│line-\d+", "the first shell's pane")
    click(col + 5, row)
    press("echo left-$((1+1))\r")
    wait(r"^.{%d}│left-2" % col, "the typed line's answer in the left pane")
    print("saw: a split pane beside it, and a click moved the focus")
    show("two panes, the left one in focus")

    # 5. A click on a row of the sidebar shows that box in the pane in focus.
    row, col = where(r"^.[○●✓] \S+ · engine", "an engine's row in the sidebar")
    click(5, row)
    wait(r"┌ ○ \S+ · engine ─", "the engine in the pane that was clicked into")
    print("saw: a click on a box in the sidebar showed it in the pane")
    show("an engine beside a shell")

    # The places: the service's first terminal runs in `demo`, a repository (made by
    # scripts/terminals.sh) with a file not yet committed; the shells in the workspace.
    wait(r"^ demo main ● \d+", "the place `demo` with its branch and its changes")
    wait(r"^ workspace", "the workspace as a place of its own")
    print("saw: the sidebar groups the boxes by place, with the place's branch and git state")

    # The help: every key in force, the numbers and copy mode among them.
    press(prefix + "?")
    wait(r"keys, each after ctrl\+b", "the help's title")
    wait(r"1-9 .*blocked first", "the numbers that show a box")
    wait(r"\[ .*copy mode", "copy mode")
    show("the keys")
    press("\x1b")
    gone(r"keys, each after", "the help after a key")
    print("saw: the help lists the keys in force")

    # The keys are the owner's: settings.json says another prefix, and it holds at once.
    settings = os.path.join(os.environ["ASKK_HOME"], "data", "settings.json")
    before = open(settings).read() if os.path.exists(settings) else None
    mine = json.loads(before) if before else {}
    mine["keys"] = {"prefix": "ctrl+a", "split_right": "|"}
    with open(settings, "w") as f:
        json.dump(mine, f)
    wait(r" ctrl\+a  then  c tab  \| split right", "the foot with the new prefix, read from settings.json", seconds=15)
    press("\x01?")
    wait(r"keys, each after ctrl\+a", "the help with the new prefix")
    show("the owner's keys")
    press("\x1b")
    if before is None:
        os.remove(settings)
    else:
        with open(settings, "w") as f:
            f.write(before)
    wait(r" ctrl\+b  then  c tab  v split right", "the foot with ctrl+b again", seconds=15)
    print("saw: an edit of the keys in settings.json held at once, and back")

    # Navigate mode: the engine is in focus on the left, a shell on the right. ctrl+b w, then
    # l (no prefix) moves the focus right; Esc leaves; what is typed lands in the shell.
    press(prefix + "w")
    wait(r"^ NAVIGATE  ↑ ↓ box  \[ \] place  h j k l pane", "the foot saying navigate mode and its keys")
    show("navigate mode")
    press("l")
    wait(r"^ NAVIGATE ", "still in navigate mode after a key")
    press("\x1b")
    gone(r"^ NAVIGATE ", "navigate mode after Esc")
    press("echo nav-$((3+4))-right\r")
    row, col = where(r"│nav-7-right", "the line typed after navigate mode, in the right pane")
    print("saw: navigate mode moved the focus with l, without the prefix, and Esc left it")

    # Right-click menus: on the pane, Esc closes; again, and its sixth line copies what it shows.
    right_click(col + 4, row)
    wait(r"┌ pane · sh ", "the pane's menu, drawn over it")
    wait(r"│ split right", "its first line")
    show("a right-click menu on a pane")
    press("\x1b")
    gone(r"┌ pane · sh ", "the menu after Esc")
    right_click(col + 4, row)
    wait(r"│ copy what it shows", "the line that copies the pane")
    press("jjjjj\r")
    copied("nav-7-right", part=True)
    wait(r"copied what it shows", "the foot saying what was copied")
    print("saw: a right-click opened the menu of a pane, Esc closed it, and a line of it copied the pane (OSC 52)")
    trow, tcol = where(r"│ 1 \S+", "the line of tabs")
    right_click(tcol + 3, trow)
    wait(r"│ rename this tab", "the tab's menu")
    press("q")
    gone(r"│ rename this tab", "the tab's menu after q")
    brow, _ = where(r"^.[○●?!✓·] \S+ · engine", "an engine's row in the sidebar")
    right_click(5, brow)
    wait(r"│ split right with it", "the menu of a box in the sidebar")
    show("a right-click menu on a box")
    press("\x1b")
    gone(r"│ split right with it", "the box's menu after Esc")
    print("saw: a right-click opened the menus of a tab and of a box in the sidebar")

    # Rename: the tab shown, then the pane in focus (the shell on the right).
    press(prefix + "T")
    wait(r"^ name tab 3: ", "the foot as a line to type the tab's name into")
    press("mytab\r")
    wait(r" 3 mytab", "the tab, named")
    press(prefix + "P")
    press("mypane\r")
    wait(r"┌ ● mypane \(sh · sh\)", "the pane, named in its frame")
    print("saw: the tab and the pane were renamed")

    # Copy mode by words, by a find, and a rectangle, in the shell on the right.
    press("echo alpha beta gamma\r")
    wait(r"│alpha beta gamma", "the words to go over")
    copy_mode()
    for key in "k0wvey":
        press(key)
    copied("beta")
    print("saw: copy mode went by words (w e) and copied a word")
    copy_mode()
    press("/gamma\r")
    wait(r"found 'gamma'", "the foot saying the text was found")
    for key in "vey":
        press(key)
    copied("gamma")
    print("saw: copy mode found a text with / and copied it")
    press("printf 'abcd\\nefgh\\n'\r")
    wait(r"│efgh", "two rows to take a rectangle of")
    copy_mode()
    for key in "kk0\x16lj":
        press(key)
    wait(r"y copies the rectangle", "the pane saying a rectangle is selected")
    show("a rectangle in copy mode")
    press("y")
    copied("ab\nef")
    print("saw: copy mode copied a rectangle (ctrl+v)")

    # A box that comes to wait for the owner while it is not shown: the stand-in agent (on
    # the service's PATH) is opened by another client and moved on to its question.
    mark = len("".join(written))
    agent = ask("terminal_open", {"command": "opencode", "place": "demo", "cols": 80, "rows": 24})
    read(1.5)
    ask("terminal_type", {"id": agent, "keys": "\r"})
    wait(r"^◆\? opencode · opencode", "the agent's row, marked as told and waiting")
    wait(r"◆ opencode · opencode waits for you", "the foot saying it waits")
    seen_written(r"\x07", "the bell (BEL)", since=mark)
    seen_written(r"\x1b\]9;askk: opencode · opencode waits for you\x07", "a desktop notification (OSC 9)", since=mark)
    show("a box told of")
    ask("terminal_close", {"id": agent})
    print("saw: a box that came to wait while not shown rang the bell, asked for a desktop notification (OSC 9) and was marked in the sidebar")

    # The theme: the page's glass, dark, in true colour (the accent is #b8aef0, the ground
    # #000000); light at once when settings.json says so, then back.
    seen_written(r"[[;]38;2;184;174;240[m;]", "the page's accent in true colour")
    seen_written(r"[[;]48;2;0;0;0m", "the page's dark ground")
    before = open(settings).read() if os.path.exists(settings) else None
    mine = json.loads(before) if before else {}
    mine["terminal"] = {"theme": "glass-light"}
    mark = len("".join(written))
    with open(settings, "w") as f:
        json.dump(mine, f)
    seen_written(r"[[;]48;2;247;243;236m", "the page's light ground (#f7f3ec)", since=mark)
    show("the light glass")
    if before is None:
        os.remove(settings)
    else:
        with open(settings, "w") as f:
            f.write(before)
    mark = len("".join(written))
    seen_written(r"[[;]48;2;0;0;0m", "the dark ground again", since=mark)
    print("saw: the theme is the page's glass in true colour, and light from settings.json at once")

    # 6. ctrl+b q: detach.
    leave()

# scripts/shots/tui.py borrows `Screen` without walking.
if __name__ == "__main__":
    main()
