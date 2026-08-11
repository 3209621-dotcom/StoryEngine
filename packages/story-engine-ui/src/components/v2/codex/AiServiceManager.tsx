import { useMemo, useState } from "react";

import { GROUP_LABELS, PROVIDER_PRESETS, type ProviderPreset, type ProviderPresetGroup } from "../../../constants/providerPresets.js";
import type { SavedProvider } from "../../ModelSettingsDialogTypes.js";

const GROUP_ORDER: readonly ProviderPresetGroup[] = ["overseas", "china", "aggregator", "local"];

const GROUP_LABELS_SHORT: Record<ProviderPresetGroup, string> = {
  overseas: "海外",
  china: "国产",
  aggregator: "聚合",
  local: "本地",
};

const PRESET_IDS = new Set(PROVIDER_PRESETS.map((p) => p.id));

interface AiServiceManagerProps {
  readonly savedProviders: readonly SavedProvider[];
  /** 点卡片：id = 预设或已存服务商 id；null = 新建自定义服务。 */
  readonly onSelect: (id: string | null) => void;
}

/** 密钥就绪（已存或不需要）→ 可写作。状态文案只说事实：不说「已连接」（没测过连通）。 */
function statusOf(saved: SavedProvider | undefined): { text: string; dot: "ok" | "warn" | "" } {
  if (!saved) return { text: "未配置", dot: "" };
  if (saved.apiKeyStatus === "present" || saved.apiKeyStatus === "not_required") {
    return { text: "已配置", dot: "ok" };
  }
  return { text: "缺密钥", dot: "warn" };
}

/**
 * 服务商卡片网格：分组的预设卡片 + 已存自定义服务卡片 + 新建自定义入口。
 * 已配置的显示保存的名称与密钥状态；点卡片进入配置详情。
 */
export function AiServiceManager({ savedProviders, onSelect }: AiServiceManagerProps) {
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<ProviderPresetGroup | null>(null);

  const savedById = useMemo(() => {
    const map = new Map<string, SavedProvider>();
    for (const p of savedProviders) map.set(p.id, p);
    return map;
  }, [savedProviders]);

  /** 已存但不属于任何预设 → 自定义服务，必须在列表可见（否则存了就找不到、改不了）。 */
  const customSaved = useMemo(
    () => savedProviders.filter((p) => !PRESET_IDS.has(p.id)),
    [savedProviders],
  );

  const q = query.trim().toLowerCase();

  const filteredPresets = useMemo(() => {
    return PROVIDER_PRESETS.filter((preset) => {
      if (selectedGroup && preset.group !== selectedGroup) return false;
      if (!q) return true;
      const savedLabel = savedById.get(preset.id)?.label ?? "";
      return (
        preset.label.toLowerCase().includes(q) ||
        preset.id.toLowerCase().includes(q) ||
        savedLabel.toLowerCase().includes(q)
      );
    });
  }, [q, selectedGroup, savedById]);

  const filteredCustom = useMemo(() => {
    if (selectedGroup) return [];
    if (!q) return customSaved;
    return customSaved.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.baseUrl.toLowerCase().includes(q),
    );
  }, [customSaved, q, selectedGroup]);

  const byGroup = useMemo(() => {
    const map = {} as Record<ProviderPresetGroup, ProviderPreset[]>;
    for (const group of GROUP_ORDER) map[group] = [];
    for (const preset of filteredPresets) map[preset.group].push(preset);
    return map;
  }, [filteredPresets]);

  const groupCounts = useMemo(() => {
    const counts = {} as Record<ProviderPresetGroup, number>;
    for (const group of GROUP_ORDER) {
      counts[group] = PROVIDER_PRESETS.filter((p) => p.group === group).length;
    }
    return counts;
  }, []);

  const showCustomSection = !selectedGroup && (filteredCustom.length > 0 || !q);
  const nothingMatched = filteredPresets.length === 0 && filteredCustom.length === 0;

  return (
    <div className="asm-page">
      {/* 搜索 */}
      <div className="asm-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索服务商"
          aria-label="搜索服务商"
        />
        {query && (
          <button className="asm-search-clear" onClick={() => setQuery("")} aria-label="清空搜索" type="button">×</button>
        )}
      </div>

      {/* 分组筛选 */}
      <div className="asm-groups">
        <button
          type="button"
          className={`asm-chip ${selectedGroup === null ? "is-active" : ""}`}
          onClick={() => setSelectedGroup(null)}
        >
          全部 {PROVIDER_PRESETS.length}
        </button>
        {GROUP_ORDER.map((group) => (
          <button
            key={group}
            type="button"
            className={`asm-chip ${selectedGroup === group ? "is-active" : ""}`}
            onClick={() => setSelectedGroup(selectedGroup === group ? null : group)}
          >
            {GROUP_LABELS_SHORT[group]} {groupCounts[group]}
          </button>
        ))}
      </div>

      {/* 分组卡片网格 */}
      {GROUP_ORDER.map((group) => {
        const list = byGroup[group];
        if (list.length === 0) return null;
        return (
          <section key={group} className="asm-group">
            <h3 className="asm-group-title">{GROUP_LABELS[group]}</h3>
            <div className="asm-grid">
              {list.map((preset) => {
                const saved = savedById.get(preset.id);
                const status = statusOf(saved);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`asm-card ${saved ? "is-configured" : ""}`}
                    onClick={() => onSelect(preset.id)}
                  >
                    <span className="asm-card-top">
                      <span className="asm-card-name">{saved?.label ?? preset.label}</span>
                      <span className={`asm-dot ${status.dot}`} />
                    </span>
                    <span className="asm-card-status">{status.text}</span>
                    {saved && saved.label !== preset.label
                      ? <span className="asm-card-hint">{preset.label} · {saved.baseUrl}</span>
                      : preset.modelsHint && <span className="asm-card-hint">{preset.modelsHint}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* 自定义服务：已存的 + 新建入口 */}
      {showCustomSection && (
        <section className="asm-group">
          <h3 className="asm-group-title">自定义服务</h3>
          <div className="asm-grid">
            {filteredCustom.map((p) => {
              const status = statusOf(p);
              return (
                <button
                  key={p.id}
                  type="button"
                  className="asm-card is-configured"
                  onClick={() => onSelect(p.id)}
                >
                  <span className="asm-card-top">
                    <span className="asm-card-name">{p.label}</span>
                    <span className={`asm-dot ${status.dot}`} />
                  </span>
                  <span className="asm-card-status">{status.text}</span>
                  <span className="asm-card-hint asm-card-url">{p.baseUrl}</span>
                </button>
              );
            })}
            {!q && (
              <button type="button" className="asm-card asm-card-custom" onClick={() => onSelect(null)}>
                <span className="asm-card-plus">＋</span>
                <span className="asm-card-status">自定义服务</span>
                <span className="asm-card-hint">接入任意 OpenAI 兼容接口</span>
              </button>
            )}
          </div>
        </section>
      )}

      {nothingMatched && (
        <div className="asm-empty">没有匹配的服务商</div>
      )}
    </div>
  );
}
