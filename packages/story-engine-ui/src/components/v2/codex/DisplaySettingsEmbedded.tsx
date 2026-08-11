import { DisplaySettingsSection } from "../../DisplaySettingsSection.js";

/**
 * 整页内嵌版显示设置：写作台左侧「显示设置」按钮点击后，主区域整页显示字号调整。
 * 复用 DisplaySettingsSection（读写 displaySettingsStore，自动落盘）。
 */
export function DisplaySettingsEmbedded({ onBack }: { readonly onBack: () => void }) {
  return (
    <section className="msk-embedded ms-dialog" role="region" aria-label="显示设置">
      <header className="ms-header">
        <div className="ms-header-text">
          <h2 className="ms-title">显示设置</h2>
          <p className="ms-subtitle">聊天 / 界面 / 正文字号，调整后立即生效，刷新仍在。</p>
        </div>
        <button className="ms-close" onClick={onBack} aria-label="返回写作台">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </header>
      <div className="ms-body">
        <DisplaySettingsSection />
      </div>
    </section>
  );
}
