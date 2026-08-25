"""供应商模型聚类与倍率规范化测试。"""

from cost_control.pricing_clusters import (
    build_pricing_cluster_catalog,
    normalize_pricing_multipliers,
    pricing_cluster_id,
)


def test_pricing_cluster_id_recognizes_namespaced_model_families():
    assert pricing_cluster_id("openai/gpt-4o") == "openai"
    assert pricing_cluster_id("newapi/anthropic/claude-sonnet-4.5") == "anthropic"
    assert pricing_cluster_id("qwen3-max") == "alibaba"
    assert pricing_cluster_id("unknown-model") == "other"


def test_normalize_pricing_multipliers_keeps_only_valid_non_default_values():
    assert normalize_pricing_multipliers(
        {
            "openai": "1.5",
            "anthropic": 1,
            "google": 0,
            "deepseek": 101,
            "not-a-cluster": 2,
        }
    ) == {"openai": 1.5}


def test_build_pricing_cluster_catalog_groups_and_preserves_models():
    catalog = build_pricing_cluster_catalog(
        {"gpt-4o": {}, "claude-sonnet-4.5": {}, "unknown-model": {}}
    )
    by_id = {item["id"]: item for item in catalog}
    assert by_id["openai"]["models"] == ["gpt-4o"]
    assert by_id["anthropic"]["models"] == ["claude-sonnet-4.5"]
    assert by_id["other"]["models"] == ["unknown-model"]


def test_save_payload_accepts_and_normalizes_pricing_multipliers():
    from cost_control.web_api import WebApiMixin

    api = WebApiMixin()
    api.cfg = {}
    config, error = api._validate_save_payload(
        {"pricing_multipliers": {"openai": "1.5", "google": 1, "invalid": 2}}
    )
    assert error == ""
    assert config is not None
    assert config["pricing_multipliers"] == {"openai": 1.5}
