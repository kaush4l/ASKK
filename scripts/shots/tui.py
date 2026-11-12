#!/usr/bin/env python3
"""The full-screen `askk terminal`, screen by screen, for scripts/shots.sh.

    python3 tui.py <askk program>

Starts `askk terminal` in a pseudo-terminal (the size scripts/terminals/tui.py uses), presses
the keys a person would, and prints each screen as scripts/terminals/tui.py does with SHOW=1
("---- the screen after: <step>", the rows, "----"). It checks nothing: that is the test's
work. It only reuses the test's small terminal (`Screen`) to know what is on the screen.
"""
import fcntl
import importlib.util
import os
import pty
import select
import struct
import sys
import termios
import time

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("walk", os.path.join(here, "..", "terminals", "tui.py"))
walk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(walk)

program = sys.argv[1]
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execv(program, [program, "terminal"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", walk.ROWS, walk.COLS, 0, 0))
screen = walk.Screen()
decode = __import__("codecs").getincrementaldecoder("utf-8")("replace")


def read(seconds):
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if fd in ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if not data:
                return
            screen.write(decode.decode(data))


def show(step):
    print(f"---- the screen after: {step}")
    print("\n".join(screen.rows()))
    print("----", flush=True)


def press(keys, wait=1.0):
    os.write(fd, keys.encode())
    read(wait)


B = "\x02"  # ctrl+b, the prefix
read(4)
show("the first screen")
press(B + "?")
show("the keys")
press("\x1b")
press(B + "w")
show("the boxes")
press("\r", 2)
show("a box in the pane")
press(B + "c", 2)
press("ls -la\r", 1.5)
show("a shell in a new tab")
press(B + "v", 2)
show("a split pane beside it")
press(B + "z")
show("one pane zoomed")
press(B + "z")
press(B + "q", 2)
try:
    os.kill(pid, 15)
except ProcessLookupError:
    pass
