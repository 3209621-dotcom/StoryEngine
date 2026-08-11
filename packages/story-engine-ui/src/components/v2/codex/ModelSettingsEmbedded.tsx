import { AiSettingsPage } from "./AiSettingsPage.js";

/**
 * 整页内嵌版 AI 设置：写作台左侧「AI 设置」按钮点击后，主区域整页显示。
 * 服务商卡片网格（仿 inkos ServiceListPage）+ 点卡片进配置面板（ServiceDetailPage 模式）。
 */
export function ModelSettingsEmbedded({ onBack }: { readonly onBack: () => void }) {
  return <AiSettingsPage onBack={onBack} />;
}
