import { useEffect, useMemo, useState } from "react";
import type { PriceEntry, PricingCluster } from "../lib/types";

function formatRate(value: number | undefined, multiplier: number): string {
  if (value == null) return "-";
  const effective = value * multiplier;
  return effective.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function parseMultiplier(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0.01 && value <= 100 ? value : 1;
}

export function PricingCatalog({
  clusters,
  defaults,
  multipliers,
  onMultiplierChange,
}: {
  clusters: PricingCluster[];
  defaults: Record<string, PriceEntry>;
  multipliers: Record<string, string>;
  onMultiplierChange: (clusterId: string, value: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(clusters[0]?.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!clusters.some((cluster) => cluster.id === selectedId)) {
      setSelectedId(clusters[0]?.id ?? "");
    }
  }, [clusters, selectedId]);

  const selected =
    clusters.find((cluster) => cluster.id === selectedId) ?? clusters[0];
  const rawMultiplier = selected ? multipliers[selected.id] ?? "1" : "1";
  const multiplier = parseMultiplier(rawMultiplier);
  const modelRows = useMemo(
    () =>
      (selected?.models ?? [])
        .map((model) => ({ model, entry: defaults[model] ?? {} }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    [defaults, selected],
  );

  if (!selected) return null;

  return (
    <div className="pricing-catalog">
      <aside className="pricing-cluster-sidebar" aria-label="供应商聚类目录">
        <div className="pricing-cluster-sidebar-title">供应商聚类</div>
        <div className="pricing-cluster-directory" role="tablist" aria-orientation="vertical">
          {clusters.map((cluster) => {
            const raw = multipliers[cluster.id] ?? "1";
            const factor = parseMultiplier(raw);
            const active = cluster.id === selected.id;
            return (
              <button
                key={cluster.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`pricing-cluster-item ${active ? "is-active" : ""}`}
                onClick={() => setSelectedId(cluster.id)}
              >
                <span className="pricing-cluster-item-main">
                  <span className="pricing-cluster-name">{cluster.name}</span>
                  <span className="pricing-cluster-count">{cluster.models.length}</span>
                </span>
                {factor !== 1 && (
                  <span className="pricing-cluster-factor">{factor}×</span>
                )}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="pricing-cluster-detail" role="tabpanel">
        <div className="pricing-cluster-detail-head">
          <div>
            <div className="pricing-cluster-detail-title-row">
              <h3>{selected.name}</h3>
              <span className="pricing-cluster-model-count">
                {modelRows.length} 条计费规则
              </span>
              <span
                className={`pricing-cluster-current-factor ${multiplier !== 1 ? "is-custom" : ""}`}
              >
                当前 {multiplier}×
              </span>
            </div>
            <div className="muted small">
              USD / 百万 token；下表显示应用聚类倍率后的当前生效价。
            </div>
          </div>
          <button
            type="button"
            className="btn pricing-multiplier-toggle"
            aria-expanded={editingId === selected.id}
            onClick={() =>
              setEditingId((current) =>
                current === selected.id ? null : selected.id,
              )
            }
          >
            {editingId === selected.id ? "收起倍率" : "设置聚类倍率"}
          </button>
        </div>

        {editingId === selected.id && (
          <div className="pricing-multiplier-editor">
            <div className="pricing-multiplier-copy">
              <span className="pricing-multiplier-label">{selected.name} 模型聚类倍率</span>
              <span className="muted small">
                对该聚类的内置价和 Provider 自定义价统一相乘，修改后自动保存。
              </span>
            </div>
            <label className="pricing-multiplier-input-wrap">
              <input
                type="number"
                min="0.01"
                max="100"
                step="0.05"
                className="budget-input pricing-multiplier-input"
                value={rawMultiplier}
                onChange={(event) =>
                  onMultiplierChange(selected.id, event.target.value)
                }
                onBlur={() => {
                  const value = Number(rawMultiplier);
                  if (!Number.isFinite(value) || value < 0.01 || value > 100) {
                    onMultiplierChange(selected.id, "1");
                  }
                }}
                aria-label={`${selected.name} 模型聚类倍率`}
              />
              <span>×</span>
            </label>
            {multiplier !== 1 && (
              <button
                type="button"
                className="pricing-multiplier-reset"
                onClick={() => onMultiplierChange(selected.id, "1")}
              >
                恢复 1×
              </button>
            )}
          </div>
        )}

        <div className="pricing-rule-scroll">
          <table className="pricing-catalog-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>输入</th>
                <th>缓存命中</th>
                <th>输出</th>
                <th>缓存写入</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.map(({ model, entry }) => (
                <tr key={model}>
                  <td className="mono">{model}</td>
                  <td title={`基准价 ${entry.input ?? "-"} × ${multiplier}`}>
                    {formatRate(entry.input, multiplier)}
                  </td>
                  <td title={`基准价 ${entry.input_cached ?? "-"} × ${multiplier}`}>
                    {formatRate(entry.input_cached, multiplier)}
                  </td>
                  <td title={`基准价 ${entry.output ?? "-"} × ${multiplier}`}>
                    {formatRate(entry.output, multiplier)}
                  </td>
                  <td title={`基准价 ${entry.cache_creation ?? "-"} × ${multiplier}`}>
                    {formatRate(entry.cache_creation, multiplier)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
