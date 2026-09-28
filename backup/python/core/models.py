"""The model catalogue — so an agent only names a model when it wants a different one.

models.json sits beside main.py:

    {"default": "local", "models": {"local": {"provider": "openai", "model": "..."}}}

An agent's `model:` may name an alias from that file or a model id directly. With no
`model:` at all, the default alias is used. Anything else the agent sets — base_url,
temperature, provider — wins over the catalogue entry.
"""

import json
from functools import cache
from pathlib import Path

from .inference import PROVIDERS, BaseInference

MODELS_FILE = Path(__file__).resolve().parent.parent / "models.json"

INFERENCE_KEYS = (
    {"provider"}
    | set(BaseInference.model_fields)
    | {field for provider in PROVIDERS.values() for field in provider.model_fields}
)


@cache
def catalogue() -> dict:
    return json.loads(MODELS_FILE.read_text()) if MODELS_FILE.is_file() else {}


def resolve(settings: dict) -> tuple[str, dict]:
    """Turn an agent's inference settings into a provider name and its arguments."""
    known = catalogue()
    models = known.get("models", {})

    settings = dict(settings)
    alias = settings.pop("model", None) or known.get("default")

    if alias in models:
        entry = dict(models[alias])
    else:
        entry = {"model": alias} if alias else {}

    entry.update(settings)
    return entry.pop("provider", "openai"), entry
