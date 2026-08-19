# syntax=docker/dockerfile:1
# The HARNESS guest. Not a workstation: it is the filesystem the ten tools in
# crates/agent/src/workspace.rs run their shell against, and nothing else.
#
# THERE IS NO NETWORK IN THIS GUEST. crates/adapters_web/src/c2w.js:92 boots
# ["/bin/sh"] and web/c2w/worker.js forwards only {info, args} — no
# c2w-net-proxy, no --net — so `apk add` at runtime cannot work. Whatever is
# not here at build time does not exist. That is why the package list is
# argued rather than convenient.
#
# Build it with docs/IMAGE-RECIPE.md §2b. Nothing else builds it.

# ---- base: upstream Alpine ------------------------------------------------
# TODO(pin): resolve and paste the digest, then this line becomes
#   FROM --platform=linux/amd64 alpine:3.24.1@sha256:<digest> AS base
# and the guest stops moving under us. It is UNRESOLVED: the tag alone is not
# reproducible, and Docker was not running when this file was written, so no
# honest digest could be obtained. Resolve it with:
#   docker buildx imagetools inspect alpine:3.24.1
# The guest shipped today is layer sha256:55afa1ec… (diff_id sha256:34884abb…,
# config created 2026-06-16T00:01:29Z) — web/c2w/img/blobs/sha256/d529dd0c….
# Record whether the digest you resolve still yields that layer.
FROM --platform=linux/amd64 alpine:3.24.1 AS base

# NO `apk add` LINE. Every binary the harness names is a busybox applet already
# in the minirootfs. The complete named-caller inventory, from the source:
#   /bin/sh, set, printf, kill, wait, test  ash builtins
#                                           (adapters_web/src/c2w.js:100,177;
#                                            core/src/process.rs, procwatch.rs)
#   stty                                    c2w.js:100 — `stty -echo` on the PTY
#   cat                                     kernel/workspace.rs:75
#   printf, base64, mkdir, dirname          kernel/workspace.rs:92;
#                                           core/src/procstart.rs:31
#   ls                                      kernel/workspace.rs:137 (`ls -1Ap`)
#   find, grep, head                        core/findfiles.rs:22-28
#   uname, cut, pwd, wc, awk, df            core/observe.rs:51-60
#   date, sleep, tail, rm, basename, tr     core/procstart.rs:31-35,
#                                           procwatch.rs:18,69-72,
#                                           proctable.rs:28-35
# Nothing in crates/ shells out to python3, node, git, curl, make or a compiler.
# `grep -I` (core/findfiles.rs:26) is the one applet flag under question — see
# docs/IMAGE-RECIPE.md §6 item 1.

# ---- flatten: one layer, and deletions that are real ---------------------
# THE WHITEOUT TRAP (IMAGE-RECIPE §4). c2w/imagemounter does not apply layer
# whiteouts, so a file removed in a later layer REAPPEARS in the guest. In the
# old hermes image that silently undid every trim: ~25,000 files where the
# build intended ~7,000. `FROM scratch` + `COPY --from` re-materialises the
# tree, so this stage is the only place a deletion can ever be honest. It is
# here from day one even though nothing is deleted yet, because the first `rm`
# added above it would otherwise no-op and no test would catch it.
FROM --platform=linux/amd64 scratch
COPY --from=base / /

# TERM: c2w.js:188-189 strips escape sequences out of every capture, so the
#   guest may emit them; `linux` is terminfo busybox already carries.
# LANG: C.UTF-8 so the model's UTF-8 output survives the round trip.
# HOME: procstart writes .harness/proc/<name>/ relative to the workspace, but
#   an interactive `cd` with no argument must land somewhere that exists.
# PATH: the minirootfs default, restated rather than inherited — it is the
#   only Env the shipped OCI config carries today.
ENV TERM=linux LANG=C.UTF-8 HOME=/root \
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /root
# c2w.js:92 passes ["/bin/sh"] explicitly and overrides this. It is set anyway
# so the image is runnable under plain `docker run` for the unit check.
CMD ["/bin/sh"]
