import React from "react";

/* ------------------------------------------------------------------ */
/*  ErrorBoundary props & state                                        */
/* ------------------------------------------------------------------ */

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onGoHome?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/* ------------------------------------------------------------------ */
/*  ErrorBoundary class component                                      */
/* ------------------------------------------------------------------ */

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle ?? "组件加载出错";
      const error = this.state.error;

      return (
        <div
          style={{
            backgroundColor: "#1f1e1b",
            border: "1px solid #2e2d2a",
            borderRadius: 14,
            padding: 20,
            color: "#e8e6e1",
            maxWidth: 520,
            margin: "40px auto",
          }}
        >
          {/* Icon + Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: "rgba(184,107,107,0.15)",
                flexShrink: 0,
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#b86b6b"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </span>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#e8e6e1" }}>{title}</h3>
          </div>

          {/* Error details (collapsible) */}
          {error ? (
            <details style={{ marginBottom: 16 }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "#9a9893",
                  fontSize: 13,
                  userSelect: "none",
                }}
              >
                查看错误详情
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  backgroundColor: "#161513",
                  border: "1px solid #2e2d2a",
                  borderRadius: 8,
                  color: "#b86b6b",
                  fontSize: 12,
                  lineHeight: 1.5,
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {error.message}
                {error.stack ? `\n\n${error.stack}` : ""}
              </pre>
            </details>
          ) : null}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={this.handleRetry}
              type="button"
              style={{
                padding: "8px 18px",
                border: "1px solid #c8956c",
                borderRadius: 8,
                backgroundColor: "transparent",
                color: "#c8956c",
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              重试
            </button>
            {this.props.onGoHome ? (
              <button
                onClick={this.props.onGoHome}
                type="button"
                style={{
                  padding: "8px 18px",
                  border: "1px solid #2e2d2a",
                  borderRadius: 8,
                  backgroundColor: "transparent",
                  color: "#9a9893",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                返回首页
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
