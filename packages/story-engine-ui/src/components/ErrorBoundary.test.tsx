import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ErrorBoundary from "./ErrorBoundary.js";

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("test error");
  return <div>child content</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("child content")).toBeDefined();
  });

  it("renders fallback UI when child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallbackTitle="出错了">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("出错了")).toBeDefined();
    expect(screen.getByText("查看错误详情")).toBeDefined();
    spy.mockRestore();
  });

  it("shows default title when fallbackTitle not provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("组件加载出错")).toBeDefined();
    spy.mockRestore();
  });

  it("calls onGoHome when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onGoHome = vi.fn();
    render(
      <ErrorBoundary onGoHome={onGoHome} fallbackTitle="error">
        <ThrowingComponent shouldThrow={true} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("返回首页"));
    expect(onGoHome).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
