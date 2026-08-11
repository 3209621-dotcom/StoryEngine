# Changelog

## 2026-08-12 长篇耐力修复批 + 联网检索

- **新增 `web_search` 工具**：写作查真实世界资料（免 key、只读、附来源、诚实失败、防提示注入）
- **会话历史治理**：冷热分层（热窗口 + 只增不删的冷归档 + 用户可见的归档标记）、
  窗口纪元对账（旧页面过期副本不再覆盖热窗）、防误清守卫（空列表不得覆盖非空历史，
  根治「加载瞬时失败→自动保存清空全部聊天记录」的数据丢失地雷）、JSON body 上限 1MB→32MB
- **写作意图门（generate_draft）**：入库后模型擅自续写被确定性拦截；否定按子句作用域判定
  （「只写这一章，不要写其他章」放行、「确认定稿，下一章不要写」拦截）
- **线索维护闭环**：入库摘要确定性提醒堆积（open+touched 达阈值）→ 用户点头 → 清理/语义归并
- **题材中立**：摘除引擎里早期测试书残留的悬疑关键词表（HOOK_KEYWORDS），
  伏笔/线索全面回归「模型声明 + 证据校验」通道
- **书架修复**：时间戳不再恒显「刚刚」、最近书排序不再反转、扫描不再回滚刚改名/刚打开的条目
- 其余：聊天 markdown 分隔线假列表项、反复出场未建卡角色确定性点名、
  重载后僵尸「正在定稿…」字幕结算、keepalive 64KiB 配额守卫等

## StoryEngine v1 Candidate

This repository captures the standalone StoryEngine backend v1 candidate state.

Frozen / accepted modules:

- Radio V1.1
- Reference Matching Calibration V1
- Intent Lifecycle Diagnostics V1.1
- Maintenance Reviewer Integration V1
- `mark_thread_done` confirm path

Disabled paths:

- `merge_threads` confirm
- `drop_thread` confirm
- automatic cleanup
- automatic expiry
- automatic `mark_thread_done`
- automatic `apply-review-plan --confirm`

Current recommended next phase:

- UI / Chapter Steering
- state overview panel
- chapter preview / commit panel
- manuscript review and readback audit
- prompt cache metrics / fingerprinting before prompt reordering
