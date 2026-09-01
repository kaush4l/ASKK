# The sandbox's userland.
#
# Alpine, plus anything that has to be INSIDE the guest to be usable. The
# constraint that decides what belongs here, measured: c2w passes the command to
# the guest through a channel capped at 1024 bytes, so a program cannot be sent
# in as part of a command line. It is in the image or it does not exist.
#
# That is why the MCP server is a file here rather than a string in an agent
# file. An MCP server is a process, and a process needs a program on disk.
FROM alpine:3.21

# One MCP server over stdio, in POSIX sh — no runtime to install, and it proves
# the transport with the shell that is already in the base image.
COPY mcp-disk /usr/local/bin/mcp-disk
RUN chmod +x /usr/local/bin/mcp-disk
