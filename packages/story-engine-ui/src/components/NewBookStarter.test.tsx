import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CreateBookDraft } from "../types.js";
import NewBookStarter from "./NewBookStarter.js";

afterEach(() => cleanup());

describe("NewBookStarter", () => {
  it("不渲染时返回 null", () => {
    const { container } = render(
      <NewBookStarter open={false} onCancel={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("只问书名：没有 7 步填表机的多步设定，只有一个书名输入", () => {
    render(<NewBookStarter open onCancel={vi.fn()} onCreate={vi.fn()} />);

    expect(screen.getByLabelText("书名")).toBeInTheDocument();
    // 极简：不再有 7 步机的「世界规则 / 主角边界」等步骤标题
    expect(screen.queryByText("世界规则")).toBeNull();
    expect(screen.queryByText("主角边界")).toBeNull();
  });

  it("书名为空时创建按钮禁用，填了书名后可创建", () => {
    render(<NewBookStarter open onCancel={vi.fn()} onCreate={vi.fn()} />);

    const createButton = screen.getByRole("button", { name: "创建并开始" });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("书名"), { target: { value: "未命名的故事" } });
    expect(createButton).not.toBeDisabled();
  });

  it("创建时只传仅含 title 的极简 draft，其余字段留空（靠进台后对话搭建）", () => {
    const onCreate = vi.fn();
    render(<NewBookStarter open onCancel={vi.fn()} onCreate={onCreate} />);

    fireEvent.change(screen.getByLabelText("书名"), { target: { value: "  林晚  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建并开始" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const draft = onCreate.mock.calls[0][0] as CreateBookDraft;
    expect(draft.title).toBe("林晚");
    // 题材中立 + 极简：其余字段全部为空，绝不预设题材
    expect(draft.genre).toBe("");
    expect(draft.logline).toBe("");
    expect(draft.protagonistName).toBe("");
    expect(draft.worldPremise).toBe("");
  });

  it("只问书名：没有灵感 chips、没有必选题材下拉（题材中立，灵感交给进台后的开书对话）", () => {
    render(<NewBookStarter open onCancel={vi.fn()} onCreate={vi.fn()} />);

    // 绝不做必选题材下拉
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    // 不再有灵感 chips（点了会把书名设成题材词的旧行为已去除）
    expect(screen.queryByLabelText("灵感起手")).toBeNull();
    expect(screen.queryByText("末日悬疑")).toBeNull();
  });

  it("点取消调用 onCancel", () => {
    const onCancel = vi.fn();
    render(<NewBookStarter open onCancel={onCancel} onCreate={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
