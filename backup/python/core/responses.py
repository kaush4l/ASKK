"""Structured LLM replies in TOON (`field: value` blocks, cheap) or JSON (universal).

The format is carried by the response class itself, so callers never pass it around:

    Reply = ReActResponse.with_format("json")
    Reply.instructions()        # prompt side
    Reply.model_validate(text)  # parse side

Subclasses only declare fields; both behaviours are inherited.
"""

import json
from typing import Any, ClassVar, Literal, get_args, get_origin

from pydantic import BaseModel, Field, field_validator, model_validator

Format = Literal["toon", "json"]
DEFAULT_FORMAT: Format = "toon"


class BaseResponse(BaseModel):
    format: ClassVar[Format] = DEFAULT_FORMAT

    @classmethod
    def with_format(cls, fmt: Format) -> type["BaseResponse"]:
        """The same response, speaking a different format."""
        return cls if fmt == cls.format else type(cls.__name__, (cls,), {"format": fmt})

    @classmethod
    def instructions(cls) -> str:
        fields, example = [], []
        for name, field in cls.model_fields.items():
            kind, sample = cls._shape(field.annotation, name)
            shown = field.json_schema_extra or {}
            kind, sample = shown.get("kind", kind), shown.get("example", sample)
            fields.append(f"- {name} ({kind}): {field.description or ''}")
            example.append(f"{name}: {sample}")
        header = "## RESPONSE FORMAT\n\n"

        if cls.format == "json":
            return (
                header
                + "Reply with a single JSON object, no markdown fences, with these fields:\n\n"
                + "\n".join(fields)
                + "\n"
            )

        return (
            header
            + "Reply in TOON: one `field: value` per block, blank line between blocks.\n"
            "List values use bracket notation [item one, item two].\n"
            "No markdown fences, no bold, no bullets, no other field names.\n\n"
            + "\n".join(fields)
            + "\n\n### Example\n\n"
            + "\n\n".join(example)
            + "\n"
        )

    @classmethod
    def _shape(cls, annotation: Any, name: str) -> tuple[str, str]:
        """How a field is described and shown in the example."""
        if get_origin(annotation) is not list:
            return "text", f"<{name}>"
        if get_origin(get_args(annotation)[0]) is list:
            return "list of lists", "[[item one, item two], [item three]]"
        return "list", "[item one, item two]"

    @classmethod
    def fields(cls, text: str, complete: bool = False) -> dict:
        """The fields readable in a reply so far.

        While the reply is still arriving the last field is still being written, so it is
        held back until the stream ends. JSON cannot be read at all until it closes.
        """
        if cls.format == "json":
            try:
                return cls._parse_json(text)
            except Exception:
                return {}
        found = cls._parse_toon(text)
        return found if complete else dict(list(found.items())[:-1])

    @classmethod
    def recovered(cls, text: str) -> "BaseResponse":
        """Last resort: the model's own words, in a response the loop can still use."""
        return cls.model_construct()

    @model_validator(mode="before")
    @classmethod
    def parse_text(cls, value: Any) -> Any:
        """Accept raw model output wherever a dict is expected."""
        if not isinstance(value, str):
            return value
        return cls._parse_json(value) if cls.format == "json" else cls._parse_toon(value)

    @classmethod
    def _parse_json(cls, text: str) -> dict:
        start, end = text.find("{"), text.rfind("}")
        return json.loads(text[start : end + 1]) if start != -1 and end != -1 else {}

    @classmethod
    def _parse_toon(cls, text: str) -> dict:
        lines = text.splitlines()
        starts = []
        for index, line in enumerate(lines):
            key, separator, rest = line.strip().partition(":")
            key = key.strip().strip("*-# ").lower()
            if separator and key in cls.model_fields:
                starts.append((index, key, rest.strip()))

        data: dict[str, Any] = {}
        for position, (index, key, first_line) in enumerate(starts):
            end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
            block = "\n".join([first_line, *lines[index + 1 : end]]).strip()
            data[key] = cls._coerce(cls.model_fields[key].annotation, block)
        return data

    @classmethod
    def _coerce(cls, annotation: Any, text: str) -> Any:
        """Text -> str, list[str], or list[list[str]], following the field's annotation."""
        if get_origin(annotation) is not list:
            return text
        inner = get_args(annotation)[0]
        return [cls._coerce(inner, item) for item in cls._split(text)]

    @staticmethod
    def _split(text: str) -> list[str]:
        """Split a bracketed list on its top-level commas, ignoring nested ones."""
        text = text.strip()
        if text.startswith("[") and text.endswith("]"):
            text = text[1:-1]

        items, current, depth = [], [], 0
        for character in text:
            if character in "([{":
                depth += 1
            elif character in ")]}":
                depth -= 1
            if character == "," and depth == 0:
                items.append("".join(current).strip())
                current = []
            else:
                current.append(character)
        items.append("".join(current).strip())
        return [item for item in items if item]


class ReActResponse(BaseResponse):
    thoughts: list[str] = Field(default=[], description="your reasoning, one step per item")
    observations: list[str] = Field(default=[], description="what the last result told you")
    do: Literal["tool", "done"] = Field(
        description="exactly 'tool' to run tools, or 'done' to reply to the user — never "
        "a tool name, tool names belong in act"
    )
    act: str = Field(
        default="",
        description="what do asked for. With 'tool', the tools to run, each written as "
        'name({"key": "value"}) and grouped [[first, second], [third]] — those in the '
        "same inner list run at the same time, the lists run one after another. With "
        "'done', the reply to the user, in plain words. One or the other, never both.",
        json_schema_extra={
            "kind": "tool calls, or text",
            "example": '[[first({"key": "value"}), second({"key": "value"})]] '
            "— or the reply itself, when do is done",
        },
    )

    @property
    def calls(self) -> list[list[str]]:
        """The tool calls in act, when do asked for tools."""
        return self._coerce(list[list[str]], self.act) if self.do == "tool" else []

    @property
    def answer(self) -> str:
        """The text in act, when do said the work is done."""
        return self.act if self.do == "done" else ""

    @field_validator("do", mode="before")
    @classmethod
    def coerce_do(cls, value: Any) -> Any:
        """A model that writes a tool name here meant 'tool'."""
        return value if value in ("tool", "done") else "tool"

    @classmethod
    def recovered(cls, text: str) -> "ReActResponse":
        """Unparseable after every repair: say what came back and stop looping."""
        return cls.model_construct(do="done", act=text)
