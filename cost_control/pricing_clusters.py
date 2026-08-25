"""内置模型定价的供应商聚类与倍率规范化。

定价快照为了提高模型名匹配率，只保留了 OpenRouter slug 的模型部分，未保留
供应商命名空间。本模块按稳定的模型家族前缀恢复供应商聚类；无法可靠识别的模型
统一进入 ``other``，避免因猜错供应商而套用错误倍率。
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

# 顺序同时决定前端目录的显示顺序。越具体的家族放在越靠前的位置。
PRICING_CLUSTERS: tuple[dict[str, Any], ...] = (
    {"id": "openai", "name": "OpenAI", "prefixes": ("gpt-", "o1", "o3", "o4")},
    {"id": "anthropic", "name": "Anthropic", "prefixes": ("claude-",)},
    {"id": "google", "name": "Google", "prefixes": ("gemini-", "gemma-")},
    {"id": "deepseek", "name": "DeepSeek", "prefixes": ("deepseek-",)},
    {"id": "alibaba", "name": "阿里云 / Qwen", "prefixes": ("qwen", "qwq-")},
    {"id": "zhipu", "name": "智谱 AI", "prefixes": ("glm-",)},
    {
        "id": "mistral",
        "name": "Mistral AI",
        "prefixes": (
            "mistral-",
            "mixtral-",
            "codestral-",
            "devstral-",
            "ministral-",
            "voxtral-",
        ),
    },
    {"id": "meta", "name": "Meta", "prefixes": ("llama-", "l3-", "l3.")},
    {"id": "minimax", "name": "MiniMax", "prefixes": ("minimax-",)},
    {"id": "moonshot", "name": "Moonshot AI", "prefixes": ("kimi-",)},
    {"id": "xai", "name": "xAI", "prefixes": ("grok-",)},
    {"id": "amazon", "name": "Amazon", "prefixes": ("nova-",)},
    {"id": "cohere", "name": "Cohere", "prefixes": ("command-",)},
    {"id": "bytedance", "name": "字节跳动", "prefixes": ("doubao-", "seed-")},
    {"id": "baidu", "name": "百度", "prefixes": ("ernie-",)},
    {"id": "tencent", "name": "腾讯", "prefixes": ("hunyuan-",)},
    {"id": "xiaomi", "name": "小米", "prefixes": ("mimo-",)},
    {"id": "microsoft", "name": "Microsoft", "prefixes": ("phi-",)},
    {"id": "nvidia", "name": "NVIDIA", "prefixes": ("nemotron-",)},
    {"id": "ibm", "name": "IBM", "prefixes": ("granite-",)},
    {"id": "perplexity", "name": "Perplexity", "prefixes": ("sonar-",)},
    {"id": "ai21", "name": "AI21 Labs", "prefixes": ("jamba-",)},
    {"id": "liquid", "name": "Liquid AI", "prefixes": ("lfm-",)},
    {"id": "stepfun", "name": "阶跃星辰", "prefixes": ("step-",)},
    {"id": "reka", "name": "Reka AI", "prefixes": ("reka-",)},
    {"id": "other", "name": "其他模型", "prefixes": ()},
)

_CLUSTER_IDS = {str(item["id"]) for item in PRICING_CLUSTERS}


def pricing_cluster_id(model: str | None) -> str:
    """根据模型家族返回稳定的供应商聚类 ID，无法识别时返回 ``other``。"""
    if not model:
        return "other"
    normalized = str(model).rsplit("/", 1)[-1].strip().lower().replace("_", "-")
    for item in PRICING_CLUSTERS:
        for prefix in item["prefixes"]:
            if normalized.startswith(prefix):
                return str(item["id"])
    return "other"


def normalize_pricing_multipliers(raw: Any) -> dict[str, float]:
    """规范化 ``{cluster_id: multiplier}``，仅保留 0.01–100 且不等于 1 的值。"""
    if not isinstance(raw, Mapping):
        return {}
    out: dict[str, float] = {}
    for key, value in raw.items():
        cluster_id = str(key or "").strip().lower()
        if cluster_id not in _CLUSTER_IDS:
            continue
        try:
            multiplier = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(multiplier) or multiplier < 0.01 or multiplier > 100:
            continue
        if abs(multiplier - 1.0) > 1e-12:
            out[cluster_id] = multiplier
    return out


def build_pricing_cluster_catalog(
    defaults: Mapping[str, Any],
) -> list[dict[str, Any]]:
    """把默认定价模型分入供应商目录；空聚类不返回。"""
    grouped: dict[str, list[str]] = {str(item["id"]): [] for item in PRICING_CLUSTERS}
    for model in sorted(str(key) for key in defaults):
        grouped[pricing_cluster_id(model)].append(model)
    return [
        {
            "id": str(item["id"]),
            "name": str(item["name"]),
            "models": grouped[str(item["id"])],
        }
        for item in PRICING_CLUSTERS
        if grouped[str(item["id"])]
    ]
