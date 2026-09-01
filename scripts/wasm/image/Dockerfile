# The sandbox's userland.
#
# Alpine, plus anything that has to be INSIDE the guest to be usable. The
# constraint that decides what belongs here, measured: c2w passes the command to
# the guest through a channel capped at 1024 bytes, so a program cannot be sent
# in as part of a command line. It is in the image or it does not exist.
#
# That is why the MCP server is a file here rather than a string in an agent
# file. An MCP server is a process, and a process needs a program on disk.
#
# THE SECOND CONSTRAINT, and it decides everything that gets ADDED here: every
# byte in this image is downloaded by every visitor who ever runs a command, and
# GitHub blocks a file over 100 MiB AT REST. This file is both the guest's
# package list and the visitor's bandwidth bill, and there is no third party to
# appeal to about it.
#
# NO SIZE FOR THE SHIPPED MODULE IS WRITTEN HERE, for the reason
# `scripts/wasm/build.sh` gives for writing none either. This file is the OTHER
# thing that changes it — an `apk add` moves both the raw and the gzipped number
# without touching that script — so a byte count in this comment is a lie one
# build away. `build.sh` prints the live pair when it finishes and now REFUSES
# an oversized one; `scripts/wasm/toolchain-check.js` prints what the tree
# currently ships. The version of this comment that carried two byte counts was
# invalidated by the `RUN` line at the bottom of its own diff, and nothing greps
# a Dockerfile comment.
FROM alpine:3.21

# One MCP server over stdio, in POSIX sh — no runtime to install, and it proves
# the transport with the shell that is already in the base image.
COPY mcp-disk /usr/local/bin/mcp-disk
RUN chmod +x /usr/local/bin/mcp-disk

# ONE language runtime, and it is Python. Everything below is a measured reason
# to prefer it, taken on this machine against `alpine:3.21` on linux/amd64 —
# `docker export | gzip -9`, which is the flattened rootfs c2w bakes in.
#
#     userland                      rootfs raw    gzip -9      delta, gzipped
#     busybox only (this, minus     8,124,416    3,506,400     —
#       the line below)
#     + coreutils findutils grep   11,566,080    5,073,718     +1,567,318
#       sed diffutils patch make
#     + python3                    49,748,992   18,200,147    +14,693,747
#     + python3 py3-pip            69,870,080   24,638,976    +21,132,576
#     + nodejs                     75,977,728   27,782,033    +24,275,633
#     + nodejs npm                 85,618,688   29,864,268    +26,357,868
#     + gcc musl-dev make         181,105,664   66,293,910    +62,787,510
#       binutils
#
# THE WIRE COST. Python is 40% cheaper than Node for the same job. The C
# toolchain is refused on this number alone: at +62.8 MB gzipped the shipped
# `.gz` lands about two megabytes short of GitHub's 100 MiB block, which is one
# Alpine point release away from having no deploy at all.
#
# THE GUEST'S RAM, which is the argument that actually settles Python against
# Node. `VM_MEMORY_SIZE_MB` is 128 in the container2wasm Dockerfile this build
# patches, and the writable overlay lives in it. Measured peak RSS for a program
# that does nothing — `python3 -c pass` 10,980 KB, `node -e 0` 58,504 KB. Node
# spends 45% of the whole guest before the agent's code runs; Python spends 8%.
#
# STARTUP, which every command pays because the guest boots fresh for each one:
# 20 runs each, same container — `/bin/true` 5.5 ms, `python3 -c pass` 73.5 ms,
# `node -e 0` 289.5 ms. Node starts 3.9x slower, and this guest is an x86
# emulator in a browser.
#
# NOT py3-pip, and not npm: both add megabytes to install packages that cannot
# be reached. Every WASI socket in `public/sandbox/vm-worker.js` answers ENOTSUP,
# `eth0` is `qdisc noop state DOWN` and `/etc/resolv.conf` is empty, so a
# package manager here is a downloader with nothing to download —
# `CAPABILITIES.md` carries that as constraint C2.
#
# NOT the POSIX toolset either, cheap as it is: busybox already answers `grep`,
# `sed`, `find`, `diff` and `awk`, and buying GNU spellings of tools the guest
# already has moves no capability row. `patch` is the one REAL gap in that row —
# an earlier version of this comment listed it as present and it is not,
# measured: `command -v patch` against `alpine:3.21` is empty. It is refused
# anyway, and not on price: `apk add --no-cache patch` alone is +80,607 gzipped
# bytes, which is nothing. It is refused on the budget below. A patch has to be
# STAGED like any other file, out of the same command line as the file it edits,
# and at these sizes a diff of a file is never cheaper to send than the file —
# the agent already rewrites a whole file through its own store, and that path
# costs less than the one `patch` would add.
#
# NOT tcc, which would have been the cheap compiler: `apk search -x tcc` against
# alpine:3.21 returns nothing. It is not in this base image's repositories, so
# there is no small C toolchain to weigh against gcc's 62.8 MB.
#
# AND THE CEILING IS NO LONGER IN THIS FILE, which is the thing to read before
# weighing a SECOND runtime against the table above. That table answers "what
# does it cost to ship", and shipping stopped being the binding limit the moment
# Python landed. `ShellTool` stages a file by finding its path spelled on the
# command line, and the whole line is 962 units — `C2wSandbox` derives that from
# the guest's 1024-byte channel, and a space costs two. Everything a staged file
# contains comes out of what the command itself leaves, so the room is a
# per-command number and no fixed figure belongs in this comment either;
# `scripts/wasm/toolchain-check.js` prints the live budget and puts the largest
# program this tree has through it, a two-file Python suite. A second runtime
# here would buy a wider vocabulary for programs that still cannot exceed
# roughly twenty-five lines. And the sharper half of the same limit: the stager
# places the files the command MENTIONS, and an `import` is not a mention, so
# every module a program imports has to be named on the line by hand and costs
# its own name out of the same 962.
#
# THE PRUNE is three directories that cannot run HERE, which is a narrower claim
# than "unused". `ensurepip` is a bundled `pip-25.0.1-py3-none-any.whl` and this
# guest has no network to fetch from — the same C2 that refused py3-pip above,
# and a wheel is a zip, so it barely compresses and is most of the saving.
# `lib2to3` was deprecated in 3.11 and deleted from CPython in 3.13.
# `turtledemo` imports tkinter, which is not in this image (`import tkinter`
# here is `ModuleNotFoundError`). Measured on the rootfs, `gzip -9`:
# 18,199,691 -> 16,095,340, a saving of 2,104,351 bytes on the userland — and on
# the build that first carried it, 2026-09-01, the shipped `.gz` fell by
# 2,087,799 and the raw module by 2,756,928. That pair is HISTORY, not the
# current size; see the top of this file for why no current size is written
# here. Verified on the pruned image, not assumed: 40 stdlib imports still
# resolve, `unittest` runs, and a failing assertion still prints a traceback
# with its source line. The `rm` is in THIS `RUN` because a later layer cannot
# shrink an earlier one.
RUN apk add --no-cache python3 && \
    rm -rf /usr/lib/python3.12/ensurepip \
           /usr/lib/python3.12/lib2to3 \
           /usr/lib/python3.12/turtledemo
