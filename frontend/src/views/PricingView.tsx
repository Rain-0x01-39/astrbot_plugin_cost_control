import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApi } from "../hooks/useApi";
import { useAutoSave } from "../hooks/useAutoSave";
import { fmtNum } from "../lib/format";
import type {
  DeletedProviderInfo,
  MatchedDefault,
  PricingCluster,
  PricingUnpriced,
  ProviderModelInfo,
  UserPricingEntry,
} from "../lib/types";
import { Panel } from "../components/Panel";
import { Button } from "../components/Button";
import { SaveToast } from "../components/SaveToast";
import { Loading, ErrorBox } from "../components/Feedback";
import { PricingCatalog } from "../components/PricingCatalog";
import {
  DraftEntry,
  ProviderPricingCard,
  draftToEntry,
  entryToDraft,
  isDraftEmpty,
} from "../components/ProviderPricingCard";

interface PricingDisplayProvider {
  id: string;
  type?: string;
  candidates: string[];
  matchedDefault: MatchedDefault | null;
  isDeletedResidue?: boolean;
}

export function PricingView({ refreshNonce }: { refreshNonce: number }) {
  const res = useApi(() => api.getPricing(), [refreshNonce]);
  const data = res.data;
  const [drafts, setDrafts] = useState<Record<string, DraftEntry>>({});
  const [multiplierDrafts, setMultiplierDrafts] = useState<
    Record<string, string>
  >({});
  const [resetResult, setResetResult] = useState("");
  // 两段式确认：首次点击武装，4 秒内再次点击执行
  const [resetArmed, setResetArmed] = useState(false);
  const resetArmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  // 跳转信号：点击未定价告警行时递增，传给对应 provider 卡片触发脉冲动画
  const [highlightTarget, setHighlightTarget] = useState<string | null>(null);
  const [highlightSignal, setHighlightSignal] = useState(0);
  const [selectedClusterId, setSelectedClusterId] = useState("");
  // 局部未定价告警覆盖：保存后单独刷新，避免整页 refetch 导致闪烁
  const [unpricedOverride, setUnpricedOverride] = useState<
    PricingUnpriced[] | null
  >(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, DraftEntry> = {};
    const userPricing = data.user_pricing || {};
    for (const [pid, entry] of Object.entries(userPricing)) {
      next[pid] = entryToDraft(entry);
    }
    setDrafts(next);
    const nextMultipliers: Record<string, string> = {};
    const currentClusterIds = new Set(
      (data.pricing_clusters || []).map((cluster) => cluster.id),
    );
    for (const [clusterId, multiplier] of Object.entries(
      data.pricing_multipliers || {},
    )) {
      if (currentClusterIds.size > 0 && !currentClusterIds.has(clusterId)) {
        continue;
      }
      nextMultipliers[clusterId] = String(multiplier);
    }
    setMultiplierDrafts(nextMultipliers);
    setReady(true);
    setUnpricedOverride(null); // 新数据到达时清除覆盖
  }, [data]);

  const providerModels: ProviderModelInfo[] = data?.provider_models || [];
  const unpriced = unpricedOverride ?? data?.unpriced ?? [];

  // 当前配置中的 provider ID 集合
  const configIds = useMemo(
    () => new Set(providerModels.map((p) => p.id)),
    [providerModels],
  );

  // 后端返回所有「已从当前配置删除，但仍有历史用量或旧定价」的 Provider。
  // 兼容旧后端：缺少 deleted_providers 字段时，仍从定价和未定价用量推导。
  const deletedProviders = useMemo<DeletedProviderInfo[]>(() => {
    if (data?.deleted_providers) return data.deleted_providers;
    const byId = new Map<string, DeletedProviderInfo>();
    for (const pid of Object.keys(drafts)) {
      if (!configIds.has(pid)) {
        byId.set(pid, {
          provider_id: pid,
          tokens: 0,
          count: 0,
          has_pricing: true,
        });
      }
    }
    for (const u of unpriced) {
      const pid = u.provider_id || "";
      if (!pid || configIds.has(pid)) continue;
      const item = byId.get(pid) || {
        provider_id: pid,
        tokens: 0,
        count: 0,
      };
      item.tokens += u.tokens || 0;
      item.count += u.count || 0;
      byId.set(pid, item);
    }
    return Array.from(byId.values()).sort(
      (a, b) => b.tokens - a.tokens || a.provider_id.localeCompare(b.provider_id),
    );
  }, [data?.deleted_providers, drafts, unpriced, configIds]);

  // 短名：取最后一个 / 后面的部分（如 newapi/image-ocr → image-ocr）
  const shortName = (id: string) => {
    const i = id.lastIndexOf("/");
    return i >= 0 ? id.slice(i + 1) : id;
  };

  const currentDisplayList = useMemo<PricingDisplayProvider[]>(
    () =>
      providerModels.map((p) => ({
        id: p.id,
        type: p.type,
        candidates: p.candidates,
        matchedDefault: p.matched_default ?? null,
      })),
    [providerModels],
  );

  const deletedDisplayList = useMemo<PricingDisplayProvider[]>(
    () =>
      deletedProviders.map((p) => ({
        id: p.provider_id,
        type: undefined,
        candidates: p.models || [],
        matchedDefault: p.matched_default ?? null,
        isDeletedResidue: true,
      })),
    [deletedProviders],
  );

  const pricingClusters = useMemo<PricingCluster[]>(() => {
    if (data?.pricing_clusters?.length) {
      return data.pricing_clusters
        .map((cluster) => ({
          ...cluster,
          provider_ids: (cluster.provider_ids || []).filter((id) =>
            configIds.has(id),
          ),
        }))
        .filter((cluster) => cluster.provider_ids.length > 0);
    }
    const grouped = new Map<string, PricingCluster>();
    for (const provider of providerModels) {
      const id = provider.supplier_id || provider.id;
      const cluster = grouped.get(id) || {
        id,
        name: provider.supplier_name || id,
        provider_ids: [],
      };
      cluster.provider_ids.push(provider.id);
      grouped.set(id, cluster);
    }
    return Array.from(grouped.values());
  }, [data?.pricing_clusters, providerModels, configIds]);

  useEffect(() => {
    if (!pricingClusters.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(pricingClusters[0]?.id ?? "");
    }
  }, [pricingClusters, selectedClusterId]);

  const currentProviderById = useMemo(
    () => new Map(currentDisplayList.map((provider) => [provider.id, provider])),
    [currentDisplayList],
  );
  const clusterIdByProvider = useMemo(() => {
    const map = new Map<string, string>();
    for (const cluster of pricingClusters) {
      for (const providerId of cluster.provider_ids) map.set(providerId, cluster.id);
    }
    return map;
  }, [pricingClusters]);

  // 未定价告警按精确 provider_id 分组，用于可点击跳转
  const unpricedByProvider = useMemo(() => {
    type UGroup = { models: typeof unpriced; totalTokens: number };
    const map = new Map<string, UGroup>();
    for (const u of unpriced) {
      const pid = u.provider_id || "(未知)";
      const group = map.get(pid) || { models: [], totalTokens: 0 };
      group.models.push(u);
      group.totalTokens += u.tokens || 0;
      map.set(pid, group);
    }
    return Array.from(map.entries()).sort(
      (a, b) => b[1].totalTokens - a[1].totalTokens,
    );
  }, [unpriced]);

  // 存在未定价用量的精确 provider ID 集合，用于卡片背景色判定
  const unpricedIdSet = useMemo(() => {
    const s = new Set<string>();
    for (const u of unpriced) {
      const pid = u.provider_id || "";
      if (pid) s.add(pid);
    }
    return s;
  }, [unpriced]);

  const hasUnpricedUsage = (pid: string) => unpricedIdSet.has(pid);

  const updateDraft = (pid: string, patch: Partial<DraftEntry>) =>
    setDrafts((prev) => {
      const cur = prev[pid] ?? entryToDraft(undefined);
      return { ...prev, [pid]: { ...cur, ...patch } };
    });
  const clearDraft = (pid: string) =>
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[pid];
      return next;
    });
  const ensureDraft = (pid: string): DraftEntry =>
    drafts[pid] ?? entryToDraft(undefined);

  const updateMultiplier = (clusterId: string, value: string) =>
    setMultiplierDrafts((prev) => ({ ...prev, [clusterId]: value }));

  const collect = (): Record<string, UserPricingEntry> => {
    const out: Record<string, UserPricingEntry> = {};
    for (const [pid, d] of Object.entries(drafts)) {
      if (isDraftEmpty(d)) continue;
      const entry = draftToEntry(d);
      if (entry) out[pid] = entry;
    }
    return out;
  };

  const collectMultipliers = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [clusterId, raw] of Object.entries(multiplierDrafts)) {
      const multiplier = Number(raw);
      if (
        !Number.isFinite(multiplier) ||
        multiplier < 0.01 ||
        multiplier > 100
      ) {
        throw new Error("聚类倍率必须在 0.01–100 之间");
      }
      if (Math.abs(multiplier - 1) > 1e-12) out[clusterId] = multiplier;
    }
    return out;
  };

  const payload = useMemo<{
    pricing: Record<string, UserPricingEntry> | null;
    pricing_multipliers: Record<string, number> | null;
    error?: string;
  }>(() => {
    try {
      return {
        pricing: collect(),
        pricing_multipliers: collectMultipliers(),
      };
    } catch (e) {
      return {
        pricing: null,
        pricing_multipliers: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, multiplierDrafts]);

  const { status, error, flush } = useAutoSave(
    payload,
    async (p) => {
      if (p.error) throw new Error(p.error);
      await api.postSaveConfig({
        pricing: p.pricing,
        pricing_multipliers: p.pricing_multipliers,
      });
      // 局部刷新未定价告警，避免整页 refetch 导致闪烁
      try {
        const fresh = await api.getPricing();
        setUnpricedOverride(fresh.unpriced ?? []);
      } catch {
        // 刷新失败不影响保存成功
      }
    },
    { enabled: ready },
  );

  const deleteResidualData = async (providerId: string) => {
    // 先落盘其它尚在防抖期内的价格修改，避免删除后刷新覆盖用户刚输入的内容。
    if (status === "saving") {
      throw new Error("价格配置正在保存，请稍后再试");
    }
    await flush();
    await api.postDeleteProviderData(providerId);
    setUnpricedOverride(null);
    res.refetch();
  };

  if (res.loading && !data) return <Loading />;
  if (res.error) return <ErrorBox message={`加载定价失败：${res.error}`} />;

  const reset = async () => {
    // 两段式确认：首次点击武装，4 秒内再次点击执行（替代 confirm，兼容嵌入式 webview）
    if (!resetArmed) {
      setResetArmed(true);
      setResetResult("⚠ 再次点击以确认重置");
      if (resetArmTimer.current) clearTimeout(resetArmTimer.current);
      resetArmTimer.current = setTimeout(() => {
        setResetArmed(false);
        setResetResult("");
      }, 4000);
      return;
    }
    if (resetArmTimer.current) clearTimeout(resetArmTimer.current);
    setResetArmed(false);
    setResetResult("重置中…");
    try {
      await api.postSaveConfig({ pricing: {}, pricing_multipliers: {} });
      setResetResult("✅ 已重置，立即生效");
      res.refetch();
    } catch (e) {
      setResetResult(`❌ 重置失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 点击未定价告警行 → 跳转到对应 provider 卡片
  const jumpToProvider = (pid: string) => {
    const clusterId = clusterIdByProvider.get(pid);
    if (clusterId) setSelectedClusterId(clusterId);
    setHighlightTarget(pid);
    setHighlightSignal((s) => s + 1);
  };

  // 统计概要数字
  const totalProviders = currentDisplayList.length;
  const unmatchedCount = currentDisplayList.filter(
    (p) => !p.matchedDefault && isDraftEmpty(ensureDraft(p.id)),
  ).length;

  const renderProviderCard = (p: PricingDisplayProvider) => (
    <ProviderPricingCard
      key={p.id}
      providerId={p.id}
      type={p.type}
      candidates={p.candidates}
      draft={ensureDraft(p.id)}
      matchedDefault={p.matchedDefault}
      hasUserOverride={!isDraftEmpty(ensureDraft(p.id))}
      isDeletedResidue={p.isDeletedResidue}
      hasUsage={hasUnpricedUsage(p.id)}
      highlightSignal={highlightTarget === p.id ? highlightSignal : undefined}
      onChange={(patch) => updateDraft(p.id, patch)}
      onClear={() => clearDraft(p.id)}
      onDeleteData={
        p.isDeletedResidue ? () => deleteResidualData(p.id) : undefined
      }
    />
  );

  return (
    <div>
      {unpriced.length > 0 && (
        <Panel className="alert-panel">
          <h2>未定价告警（{unpricedByProvider.length} 个 Provider）</h2>
          <div className="alert-body">
            以下 Provider 有用量但无定价匹配，成本被计为 <strong>$0</strong>。
            点击行可快速跳转到对应 Provider 定价卡片。
          </div>
          <div className="unpriced-groups">
            {unpricedByProvider.map(([pid, group]) => {
              const isDeletedResidue = !configIds.has(pid);
              return (
                <div
                  key={pid}
                  className={`unpriced-group-row ${isDeletedResidue ? "is-deleted-residue" : ""}`}
                  onClick={() => jumpToProvider(pid)}
                  title={isDeletedResidue ? "该 Provider 已从当前配置删除，点击查看残留数据" : "点击跳转到定价卡片"}
                >
                  <span className="mono unpriced-pid">{shortName(pid) || "(未知)"}</span>
                  {isDeletedResidue && (
                    <span className="unpriced-residue-tag">已删除供应商残留</span>
                  )}
                  <span className="unpriced-models">
                    {group.models.length} 个模型
                  </span>
                  <span className="unpriced-tokens">
                    {fmtNum(group.totalTokens)} token
                  </span>
                  <span className="unpriced-jump-hint">点击跳转 ▸</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel className="pricing-catalog-panel">
        <div className="pricing-header">
          <h2>供应商定价</h2>
          <div className="pricing-header-stats">
            <span className="muted small">
              {pricingClusters.length} 个 AstrBot 供应商 · {totalProviders}{" "}
              个现有模型配置
            </span>
            {unmatchedCount > 0 && (
              <span className="pricing-unmatched-count">
                {unmatchedCount} 个未定价
              </span>
            )}
          </div>
        </div>
        <div className="muted small pricing-catalog-help">
          仅显示 AstrBot 当前配置中的 Provider/模型，并按{" "}
          <strong>provider_source_id</strong>{" "}
          聚类。同一供应商的模型集中在右侧；内置价格只作为现有模型的默认匹配，展开卡片即可直接覆盖。
        </div>
        {pricingClusters.length > 0 ? (
          <PricingCatalog
            clusters={pricingClusters}
            selectedId={selectedClusterId}
            onSelect={setSelectedClusterId}
            multipliers={multiplierDrafts}
            onMultiplierChange={updateMultiplier}
            renderProvider={(providerId) => {
              const provider = currentProviderById.get(providerId);
              return provider ? renderProviderCard(provider) : null;
            }}
          />
        ) : (
          <div className="muted small" style={{ margin: "8px 0" }}>
            未获取到当前 AstrBot 的 provider 配置。可在 AstrBot
            主配置添加 provider 后重载插件。
          </div>
        )}
        <div className="row" style={{ marginTop: 8, gap: 10, alignItems: "center" }}>
          <Button
            onClick={reset}
            title="清空自定义定价，恢复内置默认匹配"
            variant={resetArmed ? "danger" : "default"}
          >
            {resetArmed ? "⚠ 确认重置" : "重置全部"}
          </Button>
          <span className="muted">{resetResult}</span>
        </div>
      </Panel>

      {deletedDisplayList.length > 0 && (
        <Panel>
          <div className="pricing-header">
            <h2>已删除供应商残留</h2>
            <span className="muted small">
              {deletedDisplayList.length} 个已不在 AstrBot 配置中的 Provider
            </span>
          </div>
          <div className="pricing-residue-help">
            以下内容不属于当前供应商聚类，仅用于清理历史用量、补充记录和旧定价。
          </div>
          <div className="overrides-list">
            {deletedDisplayList.map(renderProviderCard)}
          </div>
        </Panel>
      )}

      <SaveToast status={status} error={error} />
    </div>
  );
}
