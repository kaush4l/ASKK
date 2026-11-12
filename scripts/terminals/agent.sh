#!/bin/sh
# A stand-in for a coding agent, for scripts/terminals.sh: it is started under an agent's
# name and shows, one after the other, what such a program's screen shows while it works,
# while it waits for a yes, and when it is back at its prompt. Each Enter moves it on.
wipe() { printf '\033[2J\033[H'; }
wipe
printf 'Reading the project (esc to interrupt)\n'
read -r _
wipe
printf 'Edit src/main.rs\nDo you want to make this edit? [y/n] '
read -r _
wipe
printf 'ready\n> '
read -r _
