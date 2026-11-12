#!/usr/bin/env python3
"""Drive the full-screen terminal UI once, as a person at a real terminal would.

    python3 tui.py <askk program>

`askk terminal` is started in a pseudo-terminal of 140 x 40 (so it draws its full screen,
not lines), in the environment it is called with (the home, the port). The script presses
keys and reads the screen, and says each thing it saw on a line of its own:

    saw: the sidebar lists the boxes
    saw: a pane shows the engine
    saw: a terminal box shows its live screen
    saw: a shell in a new tab ran what was typed
    "shell": 12345                      (the shell's process number, for the caller)
    saw: a split pane beside it, and a click moved the focus
    saw: a click on a box in the sidebar showed it in the pane
    saw: detached with 0

A full-screen program does not write lines: it places the cursor and writes the cells that
changed. So this script keeps the screen those writes make (`Screen`, below: just enough of
a terminal for that) and looks at its rows. With SHOW=1 it prints the screen after each step.
"""
import fcntl
import os
import pty
import re
import select
import struct
import sys
import termios
import time
import unicodedata

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
                self.control(found.group(1) or "", found.group(2))
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
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execv(program, [program, "terminal"])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    screen = Screen()
    decode = __import__("codecs").getincrementaldecoder("utf-8")("replace")

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
                screen.write(decode.decode(data))
        return True

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

    def press(keys):
        os.write(fd, keys.encode())
        read(0.2)

    def click(col, row):
        """Press and let go of the left button over a cell (counted from 0)."""
        press(f"\x1b[<0;{col + 1};{row + 1}M\x1b[<0;{col + 1};{row + 1}m")

    def where(pattern, what):
        """The row and the column at which `pattern` is on the screen."""
        wait(pattern, what)
        for number, row in enumerate(screen.rows()):
            found = re.search(pattern, row)
            if found:
                return number, found.start()

    prefix = "\x02"  # ctrl+b

    # 1. The first screen: the sidebar with every box, and a pane on an engine.
    wait(r"^ boxes", "the sidebar's heading")
    wait(r"^.[○●?!✓·] .* · engine", "an engine as a row of the sidebar")
    wait(r"^.● sh -c 'echo hello", "the terminal the service already holds, as a row of the sidebar, marked as working")
    print("saw: the sidebar lists the boxes")
    wait(r"┌ ○ \S+ · engine ─", "a pane whose frame names an engine and its state")
    wait(r"│> ", "the line to speak into, in that pane")
    wait(r"^ ctrl\+b  then  c tab  v split right", "the foot with the keys")
    print("saw: a pane shows the engine")
    show("the first screen")

    # 2. ctrl+b w: the sidebar. The terminal is working, so it is listed above the idle
    #    engines: up to the top, Enter, and the pane shows its live screen.
    press(prefix + "w")
    wait(r"choose a box", "the foot of the sidebar")
    press("kkkkkk")
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
    wait(r" 2 sh( |$)", "the second tab, named after the shell")
    print("saw: a shell in a new tab ran what was typed")
    print(f'"shell": {found.group(1)}')
    show("a shell in a new tab")

    # 4. ctrl+b v: a second shell beside the first. A click on the left pane takes the focus
    #    there: what is typed next lands in the first shell, not in the new one.
    press(prefix + "v")
    wait(r"┌ ● sh · sh ─+┐┌ ● sh · sh ─", "two panes side by side, each with a shell")
    row, col = where(r"│tui-42 shell-", "the first shell's pane")
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

    # 6. ctrl+b q: detach. The program leaves with 0; what it opened is not its business.
    press(prefix + "q")
    end = time.time() + 15
    status = None
    while time.time() < end:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        read(0.1)
    else:
        print("NOT seen: the terminal UI left after ctrl+b q")
        os.kill(pid, 15)
        sys.exit(1)
    print(f"saw: detached with {os.waitstatus_to_exitcode(status)}")


main()
