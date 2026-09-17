"""LLM inference — a base that shapes the request, providers that send it.

    BaseInference    — fields every provider shares
    OpenAIInference  — any OpenAI-compatible endpoint (default: local OMLX)
    ClaudeInference  — the Claude CLI, run as `claude -p <prompt>`

    inference()                                   # OpenAI-compatible, default endpoint
    inference("claude", model="opus")             # the CLI
    await llm.invoke("describe this", multimodal=Multimodal(images=["shot.png"]))

Multimodal holds images as file paths, URLs, or base64; each provider attaches them
the way it accepts them.
"""

import asyncio
import base64
import mimetypes
import os
from pathlib import Path
from collections.abc import AsyncIterator
from typing import Any, Literal

from openai import AsyncOpenAI
from pydantic import BaseModel, ConfigDict, PrivateAttr

DEFAULT_BASE_URL = "http://127.0.0.1:8873/v1"
DEFAULT_MODEL = "Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp"
DEFAULT_CONTEXT = 32768


class InferenceError(Exception):
    """The model could not be reached, after every retry. Raised only by stream()."""


class Delta(BaseModel):
    """One piece of a reply as it arrives. Reasoning is shown, but is not the reply."""

    text: str
    kind: Literal["text", "reasoning"] = "text"

CONTEXT_KEYS = ("max_model_len", "context_length", "max_context_length", "context_window")


class Multimodal(BaseModel):
    """Extra content to send with a prompt."""

    images: list[str] = []

    def blocks(self) -> list[dict]:
        """Images as OpenAI input_image blocks."""
        blocks = []
        for image in self.images:
            url = image if image.startswith(("http://", "https://", "data:")) else _data_url(image)
            if url:
                blocks.append({"type": "input_image", "image_url": url})
        return blocks

    def paths(self) -> list[str]:
        """Images that exist on disk, for providers that read files themselves."""
        return [image for image in self.images if Path(image).is_file()]


def _data_url(path: str) -> str | None:
    file = Path(path)
    if not file.is_file():
        return None
    mime = mimetypes.guess_type(file.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(file.read_bytes()).decode('ascii')}"


class BaseInference(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    temperature: float | None = None
    max_output_tokens: int | None = None
    context_length: int | None = None
    retries: int = 3
    retry_delay: float = 1.0

    async def stream(
        self, messages: str | list[dict], multimodal: Multimodal | None = None, **overrides
    ) -> AsyncIterator[Delta]:
        """Deltas as they arrive, retried while nothing has been said yet.

        A call that fails before the first delta is usually the endpoint, so it is worth
        trying again. Once a delta is out it has been shown, and retrying would repeat it.
        """
        for attempt in range(self.retries):
            spoken = False
            try:
                async for delta in self.deltas(messages, multimodal, **overrides):
                    spoken = True
                    yield delta
                return
            except Exception as error:
                last = error
                if spoken:
                    raise InferenceError(f"{self.model} stopped mid-reply: {error}") from error
                if attempt + 1 < self.retries:
                    await asyncio.sleep(self.retry_delay * 2**attempt)
        raise InferenceError(f"{self.model} did not answer after {self.retries} tries: {last}")

    async def deltas(
        self, messages: str | list[dict], multimodal: Multimodal | None = None, **overrides
    ) -> AsyncIterator[Delta]:
        raise NotImplementedError("Subclasses must implement deltas")

    async def invoke(
        self, messages: str | list[dict], multimodal: Multimodal | None = None, **overrides
    ) -> str:
        """The whole reply, for callers that have nothing to show it to."""
        return "".join(
            [delta.text async for delta in self.stream(messages, multimodal, **overrides)
             if delta.kind == "text"]
        )

    async def context(self) -> int:
        """How many tokens the model can take. Configured wins; otherwise ask, then guess."""
        if self.context_length is None:
            self.context_length = await self.discover() or DEFAULT_CONTEXT
        return self.context_length

    async def discover(self) -> int | None:
        """Ask the provider for the model's context length, if it can say."""
        return None

    @staticmethod
    def tokens(text: str) -> int:
        """Rough token count — four characters to a token, no tokenizer to load."""
        return len(text) // 4

    @staticmethod
    def flatten(messages: str | list[dict]) -> str:
        """Messages as one block of text, for providers that take a single prompt."""
        if isinstance(messages, str):
            return messages
        return "\n\n".join(f"{turn['role']}: {turn['content']}" for turn in messages)


class OpenAIInference(BaseInference):
    _client: AsyncOpenAI = PrivateAttr()

    def model_post_init(self, __context) -> None:
        self.base_url = self.base_url or os.getenv("BASE_URL") or DEFAULT_BASE_URL
        self.api_key = self.api_key or os.getenv("API_KEY") or "local"
        self._client = AsyncOpenAI(base_url=self.base_url, api_key=self.api_key)
        self.model = self.model or os.getenv("MODEL_ID") or DEFAULT_MODEL

    async def deltas(
        self, messages: str | list[dict], multimodal: Multimodal | None = None, **overrides
    ) -> AsyncIterator[Delta]:
        request: dict[str, Any] = {
            "model": self.model,
            "input": self._input(messages, multimodal),
            "temperature": self.temperature,
            "max_output_tokens": self.max_output_tokens,
            "stream": True,
        }
        request.update(overrides)
        stream = await self._client.responses.create(
            **{key: value for key, value in request.items() if value is not None}
        )
        async for event in stream:
            if event.type == "response.output_text.delta":
                yield Delta(text=event.delta)
            elif event.type == "response.reasoning_summary_text.delta":
                yield Delta(text=event.delta, kind="reasoning")

    async def discover(self) -> int | None:
        """GET /v1/models — local servers publish the context length, OpenAI does not."""
        try:
            listed = await self._client.models.list()
        except Exception:
            return None
        for entry in listed.data:
            if entry.id == self.model:
                fields = entry.model_dump()
                return next((fields[key] for key in CONTEXT_KEYS if fields.get(key)), None)
        return None

    @staticmethod
    def _input(messages: str | list[dict], multimodal: Multimodal | None) -> str | list[dict]:
        """Plain messages, or one user turn carrying the text and the images."""
        if multimodal is None or not (blocks := multimodal.blocks()):
            return messages
        text = BaseInference.flatten(messages)
        return [{"role": "user", "content": [{"type": "input_text", "text": text}, *blocks]}]


class ClaudeInference(BaseInference):
    """The Claude CLI: `claude -p <prompt>` in, printed answer out."""

    command: str = "claude"
    context_length: int | None = 200_000

    async def deltas(
        self, messages: str | list[dict], multimodal: Multimodal | None = None, **overrides
    ) -> AsyncIterator[Delta]:
        prompt = self.flatten(messages)
        if multimodal and (paths := multimodal.paths()):
            prompt += "\n\nAttached files:\n" + "\n".join(paths)

        arguments = [self.command, "-p", prompt]
        if self.model:
            arguments += ["--model", self.model]

        process = await asyncio.create_subprocess_exec(
            *arguments, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        while chunk := await process.stdout.read(256):
            yield Delta(text=chunk.decode(errors="ignore"))

        if await process.wait() != 0:
            stderr = (await process.stderr.read()).decode().strip()
            raise RuntimeError(f"{self.command} failed: {stderr[:500]}")


PROVIDERS: dict[str, type[BaseInference]] = {
    "openai": OpenAIInference,
    "claude": ClaudeInference,
}


def inference(provider: str = "openai", **settings) -> BaseInference:
    """Build the inference a provider name asks for."""
    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider {provider!r}; known: {sorted(PROVIDERS)}")
    return PROVIDERS[provider](**settings)
