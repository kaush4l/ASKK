# Provenance of the vendored agent-zero prompts

    upstream    https://github.com/frdel/agent-zero
    commit      6a6cecff8527b164668c7a6ab2f76b6b1ed7cfa1
    subject     Refresh context usage during generation
    licence     MIT — Copyright (c) 2025 Agent Zero, s.r.o
    vendored    2026-09-01

## Why these files are here and not a clone

`bench/scaffolds/agent-zero.js` used to read a clone in a sibling directory. Every
number that arm ever produced therefore depended on one checkout on one machine,
which is precisely what `CAPABILITIES.md` refuses to call evidence. A comparison
whose reference arm cannot be reconstructed from the repository is not a
comparison anyone can check.

These are the seventeen prompt files the scaffold actually reads — found by
tracing `readPrompt` through one `init` and one `request`, not by copying a
directory — kept at their upstream paths so the search path in `agent-zero.js`
(`prompts/`, `plugins/_code_execution/prompts/`, `plugins/_text_editor/prompts/`,
which is what `helpers/subagents.get_paths` yields for the stock profile with the
two plugins whose tools are kept) is the upstream one unchanged.

## `agent.py`, which nothing here runs either

`bench/scaffolds/agent-zero.js` cites this file FIFTEEN TIMES — the prompt
assembly, the message array, every framework message, the misformat branch — and
`bench/transport.js` rests its single divergence from the shipped transport on
one of those citations. None of them could be opened from this repository: a
reader was asked to take `agent.py:583` on trust, or to clone upstream, which is
the same thing `CAPABILITIES.md` refuses to call evidence and the same thing this
directory exists to end.

It is vendored WHOLE rather than as the excerpt around one citation, because the
citation unit here is a line number: an excerpt renumbers every line and would
break the other fourteen while fixing one.

Re-derived against this copy when it landed, and all of them hold at this commit
— `581-583` the `remove_code_fences` join that builds `system_text`, `606-610`
the `[SystemMessage(...), *history]` array, `739-763` the user message with empty
keys dropped, `767-777` the ai response, `780-782` the warning, `785-807` the
tool result added as a USER message, `1124-1130` the fall back to reasoning when
the response is empty, `1434-1439` the misformat branch, `1510-1517` the unknown
tool name, `1519-1521` the system_warning. One citation did NOT: `transport.js`
said the two-message shape was `agent.py:583`, which is the system-text join.
It now says `606-610`, which is where the array is built.

## The two python files, which nothing here runs

`helpers/extract_tools.py` and `helpers/dirty_json.py` are vendored for a
different reason: they are the ORACLE for the one place this rig is measurably
harsher than upstream. `agent-zero.js` `extractToolRequest` uses `JSON.parse`;
upstream's `extract_tool_request` goes through `_parse_json_root_object`
(`extract_tools.py`), which is `DirtyJson.parse_string`. A reply with a trailing
comma, single quotes or unquoted keys is a `misformat` here and a tool call
there. That is the divergence recorded in `CUTS`, and a claim about it that
could only be checked against a clone in someone's temp directory is the thing
`CAPABILITIES.md` refuses to accept as evidence.

Nothing in the rig imports them and no test executes them; python is not on the
gate's path. They are here so the divergence can be RE-DERIVED, from this
repository, by anyone with python3:

    cd bench/vendor/agent-zero
    python3 - <<'EOF'
    import sys; sys.path.insert(0, '.')
    from helpers.extract_tools import extract_tool_request
    for shape in [
        '{"tool_name":"code_execution_tool","tool_args":{"code":"ls"}}',
        '{"tool_name":"code_execution_tool","tool_args":{"code":"ls",}}',
        "{'tool_name': 'code_execution_tool', 'tool_args': {'code': 'ls'}}",
        '{tool_name: "code_execution_tool", tool_args: {code: "ls"}}',
        '{"tool_name":"code_execution_tool","tool_args":{"code":"ls"}',
        'Sure! {"tool_name":"response","tool_args":{"text":"hi"}}',
    ]:
        print(bool(extract_tool_request(shape)), shape[:60])
    EOF

It needs an empty `helpers/__init__.py`, `helpers/modules.py` stubbing the two
names `extract_tools.py` imports for backwards compatibility, and the `regex`
package (or a shim over `re`). The measured answers are pinned in
`test/bench/agentZeroScaffold.test.js`, which is what the gate reads.

They are copied VERBATIM. Every departure from what upstream would send is made
in code, in the `CUTS` table in `agent-zero.js`, applied through a `cut()` helper
that records a pattern which no longer matches — so a vendor bump that silently
breaks a cut is a failing test (`test/bench/agentZeroScaffold.test.js`) rather
than an arm quietly reaching for a tool this rig cannot give it.

`prompts/agent.system.main.specifics.md` is EMPTY upstream (sha256
e3b0c442… is the hash of zero bytes). It is vendored anyway because
`agent.system.main.md` includes it, and a missing include is an exception.

## Refreshing

Re-clone upstream at the commit you want, copy the same twenty paths over
this directory, update the commit and the hashes below, and run
`bun test test/bench`. A cut that no longer matches will name itself.

## sha256

Twenty files: the seventeen prompts the scaffold reads, and the three python
files above that nothing reads.

    dcd7bec77c84c0698e352b65a946e6672ae47d3265f34e4ca400d4b20d663ec2  agent.py
    8a493731d8ab4cd3200c59cd31957cd94d876c659a652cad0b420061308daedb  helpers/extract_tools.py
    69c67ca445ba8bd9f6a217d0304fca50418459c06cf9fa5a15cca992637570d1  helpers/dirty_json.py
    9eb96fa657827ef57238b1ca09b90cbbd0b7897495287e307d5c3b08de7146d1  plugins/_code_execution/prompts/agent.system.tool.code_exe.md
    180af380557a30578e229d4d26f1787ceef4f444fbf9476183eaf4b9dcb0fc3c  plugins/_text_editor/prompts/agent.system.tool.text_editor.md
    3cfc686de63078d5554fb480adeeb61f273d8bdf08035d09c66f988ba10c9754  prompts/agent.context.extras.md
    fb380abe5bd6454b9cf567e765e676b1a1316f7117a1cc64c033993ea33aa8da  prompts/agent.extras.agent_info.md
    28cc94d807d68b346d4ee373cbb41014377bc28db6953eb8fcbe246554688b63  prompts/agent.extras.workdir_structure.md
    ec4710a9d9c24a378558deae0f8d0686ee3ac74ed30cd5ad9651331bfe9d8dcc  prompts/agent.system.datetime.md
    304ae71420ed48ef719e92bec0529ec931b1b2fcb9faa452ca20027cb4dcb847  prompts/agent.system.main.communication_additions.md
    3ce2cb0b28fd2debd21c268a532b49d84e851287a95c8e00e6ae366c86244bd0  prompts/agent.system.main.communication.md
    5a31bd19b15bff1ad315313b72ba3fda66c813b6b296b68edd47a36b37cd0cf3  prompts/agent.system.main.environment.md
    e2bce5d889933b19371eb3d51a986185faa00864fcc5984e4c30c0c7bf16f97a  prompts/agent.system.main.md
    65ace26a062bd3abec5e2bec89c2b938184e7b178c9c44288a9541737034304a  prompts/agent.system.main.role.md
    a0e2a2a7dfcf23fe66e95559fc58ecf7ecf66b21287299bb39d7fbb7106a99d1  prompts/agent.system.main.solving.md
    e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  prompts/agent.system.main.specifics.md
    f34bdeaa2fcfe5d6f8bdab0e68a4f92c273ec9bf0cd55e6ffe1f8ae3ef62a516  prompts/agent.system.main.tips.md
    e8843b36c02ae4221425477443aec9fd1caf4b28abd4e4b6fbcd65f676b80bea  prompts/agent.system.response_tool_tips.md
    ca1cce965f7f2dc0f9d0e70a49dcc5ffaeb1db7c4edb9f038148079ad9e987ae  prompts/agent.system.tool.response.md
    74d45a2056ee70e5104754086f16b8ad1202fa7cd0c2ae109ec4b992db6aea15  prompts/agent.system.tools.md
