// gitignore — parse a root .gitignore file and test logical paths.
//
//   const matcher = parseGitignore(text);
//   isIgnored(matcher, "personal/memory/agent/default/state.md"); // true
//   isIgnored(matcher, "src/core/tool.js"); // false (unless a pattern matches)
//
// This is the filter the live artifact uses when it loads the
// filesystem: tree/list/search/expand exclude every path matched by
// the project's root .gitignore, so gitignored files are not loaded,
// counted, or shown to the agent as project files.
//
// Supported (git semantics, v1):
//   - Blank lines and lines starting with # are ignored. A leading
//     \# or \! is an escaped literal # or !, not a comment/negation.
//   - A trailing / marks a directory pattern: it matches that
//     directory and, via parent recursion below, everything under it.
//   - A leading / anchors the pattern to the root. Any pattern
//     containing a / in the middle is also root-anchored (git's rule);
//     a pattern with no / matches at any depth (basename or segment).
//   - * matches any characters within one path segment, ? matches
//     one character within a segment, ** matches across segments
//     (**/foo, foo/**, and a/**/b all work).
//   - ! negates: later patterns win, so the last matching pattern
//     decides. Negation re-includes a file only when its parent
//     directories are not themselves ignored — git's rule, enforced
//     by parent recursion in isIgnored(): a file under an ignored
//     directory stays ignored even if a later !file pattern matches
//     it, unless a pattern also re-includes that directory.
//     Example: "personal/" + "!personal/keep.txt" does NOT re-include
//     personal/keep.txt, because personal/ itself is ignored.
//     "personal/*" + "!personal/keep" CAN re-include personal/keep,
//     because personal/ itself is not ignored, only its children.
//
// NOT supported in v1 (documented, not silently claimed):
//   - Character classes ([a-z], [!a]): a [ is treated as a literal
//     character, so such a pattern matches only a literal [.
//   - Nested .gitignore files (in subfolders): only the root
//     .gitignore is parsed. A nested .gitignore file is itself just
//     a visible file, not a filter.
//   - .git/info/exclude and the global gitignore: not read.
//   - Escaped spaces and trailing-space rules: trailing whitespace
//     is trimmed, so a pattern ending in a space will not match.
//   - The .gitignore file itself: the files tool never filters the
//     root .gitignore file, even if a pattern would match it — it
//     must remain visible so the agent can see what is ignored.
//
// isIgnored() takes logical, workspace-relative paths ("a/b.txt",
// never "/abs/..." or "../..."). A path with ".." is never ignored
// by this matcher — it is refused elsewhere (files.js cleanPath).

function escapeRegexChar(char) {
  return char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Convert one gitignore glob segment (no /) to a regex source.
// ** is handled at the whole-pattern level, not here.
function segmentToRegex(segment) {
  let out = "";
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += escapeRegexChar(char);
    }
  }
  return out;
}

// Convert a full pattern body (slashes allowed) to a regex source
// that matches a whole logical path. `anchored` decides whether the
// pattern must start at the root (true) or may start at any segment
// boundary (false).
function patternToRegex(body, anchored) {
  const segments = body.split("/");
  let out = "";
  segments.forEach((segment, index) => {
    if (segment === "**") {
      if (segments.length === 1) {
        out += ".*";
      } else if (index === 0) {
        // "**/foo": zero or more directories, slash included.
        out += "(?:.*/)?";
      } else if (index === segments.length - 1) {
        // "foo/**": everything under foo, or foo itself.
        out += "(?:/.*)?";
      } else {
        // "a/**/b": "a/" + zero or more directories + "b".
        out += "/(?:.*/)?";
      }
      return;
    }
    // Separator before a non-** segment, except directly after a
    // leading or middle ** (which already consumed the slash).
    if (index > 0 && segments[index - 1] !== "**") {
      out += "/";
    }
    out += segmentToRegex(segment);
  });
  if (!anchored) {
    // May match at any depth: "foo" matches "foo" and "a/foo" and
    // "a/b/foo"; "*.log" matches "x.log" and "a/x.log".
    out = `(?:.*/)?${out}`;
  }
  return `^${out}$`;
}

export function parseGitignore(text) {
  const patterns = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    let line = rawLine;
    // Trailing whitespace is trimmed (see NOT supported above).
    line = line.replace(/\s+$/, "");
    if (line === "") {
      continue;
    }
    if (line.startsWith("#")) {
      continue;
    }
    let negated = false;
    if (line.startsWith("!")) {
      negated = true;
      line = line.slice(1);
    } else if (line.startsWith("\\!") || line.startsWith("\\#")) {
      line = line.slice(1);
    }
    if (line === "") {
      continue;
    }
    let dirOnly = false;
    if (line.endsWith("/")) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (line === "") {
      continue;
    }
    let anchored = false;
    if (line.startsWith("/")) {
      anchored = true;
      line = line.slice(1);
    } else if (line.includes("/")) {
      // A slash in the middle anchors to the root (git's rule).
      anchored = true;
    }
    if (line === "") {
      continue;
    }
    patterns.push({
      raw: rawLine,
      body: line,
      negated,
      dirOnly,
      anchored,
      regex: new RegExp(patternToRegex(line, anchored)),
    });
  }
  return { patterns };
}

export function emptyGitignore() {
  return { patterns: [] };
}

function cleanLogical(path) {
  return String(path ?? "")
    .split(/[\\/]+/)
    .filter((part) => part && part !== ".")
    .join("/");
}

function patternMatches(pattern, logical, isDir) {
  if (pattern.dirOnly && !isDir) {
    return false;
  }
  return pattern.regex.test(logical);
}

// Does the last matching pattern for `logical` (as a file or dir)
// ignore it, ignoring parent directories? Used internally; the
// public isIgnored() adds the parent recursion.
function selfIgnored(matcher, logical, isDir) {
  let ignored = false;
  for (const pattern of matcher?.patterns ?? []) {
    if (patternMatches(pattern, logical, isDir)) {
      ignored = !pattern.negated;
    }
  }
  return ignored;
}

// Public test. Parent recursion enforces git's rule: if any parent
// directory of the path is ignored (after all patterns, including
// negations of that directory), the path is ignored, and a negated
// file pattern alone cannot re-include it.
export function isIgnored(matcher, path, isDir = false) {
  const logical = cleanLogical(path);
  if (logical === "") {
    return false;
  }
  const slash = logical.lastIndexOf("/");
  if (slash >= 0) {
    const parent = logical.slice(0, slash);
    if (isIgnored(matcher, parent, true)) {
      return true;
    }
  }
  return selfIgnored(matcher, logical, isDir);
}
