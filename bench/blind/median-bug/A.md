# median-bug — transcript A

> **Before you score.** These two transcripts are one task, run by two
> different agent harnesses. Which letter is which is randomised per task and
> per run, and is not recorded here.
>
> **What you are reading is one projection of both.** Each harness names its
> own tools, their arguments and the sections of its prompt; here every one
> is a slot — `tool_1`, `arg_1`, `section_1`, … — numbered in the order that
> harness first used it, the same slot for the same name in every file of
> one harness. Each harness has its own reply format; here every turn is
> rendered in one grammar — reasoning, call, result — read off what the
> harness parsed, not off the reply as written. Every ending is in one
> vocabulary. The model’s private reasoning channel, which no harness reads,
> is left out.
>
> **The prompt is not rendered. Its outline is**, after the turns: one line
> per section — its slot, its token count, and from the second request on
> whether it is the same as, changed from, or added to the request before —
> with the shared prefix per request; and a table of the tool contract: each
> tool’s slot, its argument slots, and the length of its description. No
> prose of either harness reaches you. Score criteria 1 and 7 on the outline.
> Score criterion 2 on the table and on what the model did with the
> contract: the line under the table says what its first reply was and how
> many replies fit. Score THIS PAIR ALONE and do not try to match it against
> another pair.
>
> **Score all 8 criteria**; sum the 6 that are not disqualifiers
> (4 and 8). The machine check for each letter is in `outcomes.json`
> beside these files: use it for grounding, not as the verdict.
>
> The rubric is `docs/REFERENCE-PROMPTS.md`, section "The blind comparison rubric".

## task

```
median.py has a bug. Find it, fix it, and prove the fix with a test you write at test_median.py.
test_median.py must be runnable with `python3 test_median.py`, must exit 0 when the code is correct, and must exit non-zero against the original buggy version.
Do not change what the function is called or how it is called.
```

## turn 1

reasoning:
- Need inspect workspace and median.py to identify bug
- then fix and create test.
- List files
- read median.py
- fix bug
- write test_median.py
- run test to verify.

call: tool_3

call: tool_4
  arg_1: median.py

result of tool_3:
```
median.py  231 bytes
```

result of tool_4:
```
def median(numbers):
    """Return the median of a list of numbers."""
    if not numbers:
        raise ValueError("median of an empty list")
    ordered = sorted(numbers)
    middle = len(ordered) // 2
    return ordered[middle]
```

## turn 2 — answered

reasoning:
- (none)

answer:
```
We need answer user's request. Need produce fields think plan act result. Need likely fix median.py and write test_median.py. Need use tools? We have workspace. Need inspect current median.py. Bug: for even length returns upper middle instead of average of two middle. Need fix without changing function name/call. Need test runnable python3 test_median.py, exit 0 correct, non-zero against original buggy. We can write test that asserts median([1,2,3,4]) == 2.5 maybe. Need ensure if original returns 3, fail. Also maybe test odd, empty raises ValueError. Need maybe use sys.exit. Need write files. We can do tool calls. Need maybe run tests to prove. Since sandbox slow but okay. Need maybe first write fixed median.py and test_median.py, then run python3 test_median.py. Also maybe demonstrate against original? Could copy original to temp and run test? Requirement: must exit non-zero against original buggy version. We can prove by running test against original? We can create original_median.py? But test imports median? If test imports median module, to test original need median.py original. We can temporarily restore original? Better: write test that imports median. To prove against original, we can create a temp directory with original median.py and test_median.py, run. But maybe not necessary? User asks prove fix with test you write. We can run current fixed test exit 0. To prove non-zero against original, we can run a tool_2 command that creates original median in temp and runs test. But test imports median; if in temp dir with original median.py and same test, it will fail. Need ensure test uses import median. Could do:
mkdir -p /tmp/orig_median && cp test_median.py /tmp/orig_median/ && printf original > /tmp/orig_median/median.py && cd /tmp/orig_median && python3 test_median.py; echo exit=$?
But workspace maybe /Users... but tool_2 can use /tmp? likely. Or use workspace subdirectory. Need be careful 30s. Could do one tool_2 command.
Need maybe use assert with message. If assertion fails, Python exits 1. But if multiple asserts, first fail. Need maybe test even and odd.
Potential issue: median of even list should return average. If numbers ints, average float. For [1,2,3,4] expected 2.5. Original returns 3. Good.
Need not change how called: median(numbers). Keep signature.
Need maybe preserve docstring.
Fixed:
def median(numbers):
    """Return the median of a list of numbers."""
    if not numbers:
        raise ValueError("median of an empty list")
    ordered = sorted(numbers)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2

Test:
import sys
from median import median

def main():
    assert median([3,1,2]) == 2
    assert median([1,2,3,4]) == 2.5
    assert median([5]) == 5
    assert median([2,1]) == 1.5
    try:
        median([])
    except ValueError:
        pass
    else:
        raise AssertionError("empty list should raise ValueError")
    print("ok")

if __name__ == "__main__":
    main()
Need maybe if assertion fails exit non-zero. Good.
Need maybe test against original: original returns 3 for [1,2,3,4], assertion fails. But if test first asserts odd, then even fail. Good.
Need maybe use exact equality with floats? 2.5 exact. 1.5 exact. Fine.
Need maybe if numbers are Decimal? Not needed.
Need maybe if list unsorted. Good.
Need maybe if even length with negative? Could add.
Need maybe run python3 test_median.py in workspace. Need maybe run original proof. Could do after writing files.
Need response format: think list, plan list, act tool or answer. Since we need use tools, act: tool, result: tool calls only. We can include multiple tool calls on one line if independent. Need write files independent? Yes can write both in same line. Then next turn run. But maybe we can do all in one turn? We need write then run depends on write, so separate line? The instructions: Calls on one line run at same time; a call that needs earlier result goes on its own line. We can put tool_1 calls on one line, then tool_2 on next line? In a single response, can have multiple lines? It says reply with fields, result: tool calls and nothing else. Could include multiple tool calls, maybe line separated. If tool_2 depends on writes, should be on its own line after writes. Is that allowed? Yes likely. But if act tool, result can contain multiple tool calls. Need maybe do writes and then tool_2 in same result, with tool_2 on separate line. But if they execute sequentially line by line? It says calls on one line run at same time; a call that needs earlier result goes on its own line. So we can do:
tool_1(...)
tool_1(...)
tool_2(...)
But tool_2 needs writes, so separate line. Good.
Need maybe include original proof tool_2. Could do one tool_2 command that runs fixed test and original test. But if it fails original, exit code? We want observe. Use command:
python3 test_median.py; echo "fixed_exit=$?"; mkdir -p .orig
```


## the contract

| tool | arguments | description |
|---|---|---|
| tool_4 | arg_1 | 23 words |
| tool_1 | arg_1, arg_2 | 50 words |
| tool_3 | arg_1 | 25 words |
| tool_2 | arg_3 | 62 words |

first reply: a call
replies 2: calls 1, answers 1, did not fit the contract 0, never reached the harness 0

## the prompt, as an outline

```
request 1: messages 1, tokens 849
  message 1
    (no heading)                                 165 tokens
    section_1                                    271 tokens
    section_2                                    242 tokens
    section_3                                    118 tokens
    section_4                                     49 tokens
request 2: messages 1, tokens 956; same 5, changed 0, added 1, gone 0; shared prefix 801 tokens
  message 1
    (no heading)                                 165 tokens  same
    section_1                                    271 tokens  same
    section_2                                    242 tokens  same
    section_3                                    118 tokens  same
    section_5                                    106 tokens  added
    section_4                                     49 tokens  same
```

