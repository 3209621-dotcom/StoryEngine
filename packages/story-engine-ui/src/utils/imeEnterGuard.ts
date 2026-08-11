/**
 * 输入框「回车发送」的 IME 安全守卫。
 *
 * 背景（实测复现）：中文等输入法用回车「确认候选词」时，这一下 keydown 会在
 * compositionend 之后到达、此刻 event.isComposing 常已是 false——只看 isComposing 的
 * 守卫会把这次「确认回车」漏判成一次发送。用户随后再按一次回车真正发送，于是同一句话
 * 被发了两遍（用户报告的「每次说话弹两个框」）。
 *
 * 这里把「该不该在这次 Enter 上发送」收敛成一个纯函数，多重防线叠加：
 *  - isComposing / keyCode===229：合成或 IME 处理中（真实 Chrome 在 IME 期间 keydown 多为 229）；
 *  - composing（onCompositionStart/End 维护的 ref）：合成进行中的兜底；
 *  - msSinceCompositionEnd < 阈值：紧跟 compositionend 的「确认回车」窗口内不发送（兜住 isComposing
 *    已变 false 且 keyCode 非 229 的边角实现）。阈值取很短，几乎不会误挡用户随后真正的发送回车。
 */
export interface EnterKeyDecisionInput {
  readonly key: string;
  readonly shiftKey: boolean;
  /** 原生事件的 isComposing（合成进行中为 true）。 */
  readonly isComposing: boolean;
  /** 原生事件的 keyCode；IME 处理键为 229。 */
  readonly keyCode: number;
  /** onCompositionStart/End 维护的「正在合成」ref。 */
  readonly composing: boolean;
  /** 距上次 compositionend 的毫秒数；从未合成传 Infinity。 */
  readonly msSinceCompositionEnd: number;
}

/** 紧跟 compositionend 的「确认回车」在此窗口内不触发发送（毫秒）。取短，避免误挡真正的发送回车。 */
export const IME_CONFIRM_GUARD_MS = 50;

export function shouldSendOnEnterKey(input: EnterKeyDecisionInput): boolean {
  if (input.key !== "Enter" || input.shiftKey) return false;
  // 合成 / IME 处理中：绝不发送。
  if (input.isComposing || input.keyCode === 229) return false;
  if (input.composing) return false;
  // 刚结束合成的「确认回车」泄漏窗口：不发送。
  if (input.msSinceCompositionEnd < IME_CONFIRM_GUARD_MS) return false;
  return true;
}
