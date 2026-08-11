import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CustomFieldsSection } from "./CustomFieldsSection.js";

describe("CustomFieldsSection 通用自定义字段展示（破例⑦的第④步：展示）", () => {
  afterEach(cleanup);

  it("有字段时逐个渲染键与值；数组值逐条列出", () => {
    render(<CustomFieldsSection fields={{ 外号: "阿薇", 习惯: ["熬夜", "喝冰美式"] }} />);
    expect(screen.getByText("外号")).toBeInTheDocument();
    expect(screen.getByText("阿薇")).toBeInTheDocument();
    expect(screen.getByText("习惯")).toBeInTheDocument();
    expect(screen.getByText("熬夜")).toBeInTheDocument();
    expect(screen.getByText("喝冰美式")).toBeInTheDocument();
  });

  it("空对象 → 不渲染（null）", () => {
    const { container } = render(<CustomFieldsSection fields={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it("undefined → 不渲染（null）", () => {
    const { container } = render(<CustomFieldsSection fields={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("跳过空值键（值为空字符串或空数组不算有内容）", () => {
    const { container } = render(<CustomFieldsSection fields={{ 空字段: "", 空列表: [] }} />);
    expect(container.firstChild).toBeNull();
  });
});
