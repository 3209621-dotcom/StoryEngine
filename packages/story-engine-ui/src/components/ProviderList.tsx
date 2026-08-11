import { useState } from "react";

import type { ProviderListProps } from "./ModelSettingsDialogTypes.js";

/**
 * AI 服务卡片网格（仿 inkos ServiceListPage）：每个服务一张卡片，
 * 卡片上常驻名称/状态/模型数，点击展开详情（接口地址/密钥/模型列表）。
 */
export function ProviderList(props: ProviderListProps) {
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const deleteCandidate = props.savedProviders.find((provider) => provider.id === deleteCandidateId) ?? null;

  return (
    <>
      <div className="ms-section-header">
        <div className="ms-section-title-row">
          <h3 className="ms-section-title">AI 服务</h3>
          <span className="ms-badge">{props.savedProviders.length}</span>
        </div>
        <button
          type="button"
          className="ms-add-btn"
          onClick={props.onAddProvider}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          添加 AI 服务
        </button>
      </div>

      {props.savedProviders.length > 0 && (
        <div className="ms-provider-grid">
          {props.savedProviders.map((provider) => {
            const icon = provider.label.charAt(0).toUpperCase();
            const isExpanded = props.expandedProviderId === provider.id;
            const models = props.providerModels[provider.id] ?? [];
            const providerError = props.providerErrors[provider.id];
            const hasModels = models.length > 0;
            const keyOk = provider.apiKeyStatus === "present" || provider.apiKeyStatus === "not_required";
            return (
              <div key={provider.id} className={`ms-provider-card ${isExpanded ? "is-expanded" : ""}`}>
                <button
                  type="button"
                  className="ms-provider-main"
                  onClick={() => props.onToggleProvider(isExpanded ? null : provider.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="ms-provider-avatar">{icon}</span>
                  <span className="ms-provider-info">
                    <span className="ms-provider-name">{provider.label}</span>
                    <span className="ms-provider-url">{provider.baseUrl}</span>
                  </span>
                  <span className="ms-provider-statusline">
                    <span className={`ms-provider-dot ${keyOk ? "ok" : "warn"}`} />
                    {hasModels ? (
                      <span className="ms-provider-modelcount">{models.length} 模型</span>
                    ) : (
                      <span className="ms-provider-modelcount is-warning">未获取</span>
                    )}
                  </span>
                  <svg className="ms-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </button>

                {isExpanded && (
                  <div className="ms-provider-detail">
                    <div className="ms-provider-detail-grid">
                      <div className="ms-detail-field">
                        <label>接口地址</label>
                        <code>{provider.baseUrl}</code>
                      </div>
                      <div className="ms-detail-field">
                        <label>API 密钥状态</label>
                        <span className={`ms-key-status ${provider.apiKeyStatus}`}>
                          <span className="ms-key-dot" />
                          {provider.apiKeyStatus === "present" ? "已配置" : provider.apiKeyStatus === "not_required" ? "无需配置" : "未配置"}
                        </span>
                      </div>
                    </div>
                    <div className="ms-provider-actions">
                      <button
                        type="button"
                        className="ms-btn ms-btn-xs"
                        onClick={(e) => { e.stopPropagation(); props.onEditProvider(provider); }}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="ms-btn ms-btn-xs ms-btn-accent"
                        onClick={(e) => { e.stopPropagation(); props.onRefreshProvider(provider); }}
                      >
                        刷新模型
                      </button>
                      <button
                        type="button"
                        className="ms-btn ms-btn-xs ms-btn-ghost ms-btn-danger"
                        onClick={(e) => { e.stopPropagation(); setDeleteCandidateId(provider.id); }}
                      >
                        删除
                      </button>
                    </div>
                    {providerError && (
                      <div className="ms-provider-error">
                        {providerError}
                      </div>
                    )}
                    {models.length > 0 && (
                      <div className="ms-provider-models">
                        <label>可用模型 ({models.length}) · 点击分配给所有任务</label>
                        <div className="ms-model-grid">
                          {models.map((model) => (
                            <button
                              key={model.id}
                              type="button"
                              className="ms-model-tag"
                              onClick={(e) => { e.stopPropagation(); props.onAssignAll(provider.id, model.id); }}
                              title="分配给所有任务"
                            >
                              {model.name ?? model.id}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {props.savedProviders.length === 0 && !props.showProviderForm && (
        <div className="ms-empty-state">
          <div className="ms-empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <p>还没有添加 AI 服务</p>
          <button type="button" className="ms-add-btn" onClick={props.onAddProvider}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            添加 AI 服务
          </button>
        </div>
      )}

      {deleteCandidate ? (
        <div className="msk-backdrop" role="presentation" onClick={() => setDeleteCandidateId(null)}>
          <section
            aria-labelledby="provider-delete-title"
            aria-modal="true"
            className="msk-dialog ms-dialog"
            role="dialog"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDeleteCandidateId(null);
            }}
          >
            <header className="msk-header">
              <div>
                <h2 className="msk-title" id="provider-delete-title">删除 AI 服务配置？</h2>
                <p className="msk-global-note">
                  将删除 AI 服务配置「{deleteCandidate.label}」。不会删除故事项目，但可能影响后续模型调用。
                </p>
              </div>
            </header>
            <footer className="msk-footer">
              <button className="msk-btn-secondary" type="button" onClick={() => setDeleteCandidateId(null)}>
                取消
              </button>
              <button
                className="msk-btn-primary"
                type="button"
                onClick={() => {
                  props.onDeleteProvider(deleteCandidate.id);
                  setDeleteCandidateId(null);
                }}
              >
                确认删除 AI 服务
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
