import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WorldbuildingCodexPanel from "./WorldbuildingCodexPanel.js";
import type { WorldbuildingData } from "../../../api/worldbuildingClient.js";

afterEach(cleanup);

const engineFallback: WorldbuildingData = {
  overview: { oneLine: "资源受集团控制", tone: "", coreConflict: "" },
  rules: [
    { name: "规则 1", detail: "资源受集团控制" },
    { name: "固定事实", detail: "林远是千亿富豪" },
  ],
  socialStructure: ["集团层级森严"],
  forces: [],
  conflictSources: [],
  relations: [],
  storyEntries: [],
  locations: [],
};

const thick: WorldbuildingData = {
  ...engineFallback,
  overview: { oneLine: "加厚层世界观", tone: "", coreConflict: "" },
  socialStructure: ["加厚层独有圈层"],
};

describe("WorldbuildingCodexPanel fallback", () => {
  it("加厚层缺失（projectPath null、fetch 返回 null）时回退渲染引擎正典世界观", () => {
    render(<WorldbuildingCodexPanel projectPath={null} fallbackData={engineFallback} />);
    expect(screen.queryByText(/还没有世界观/)).toBeNull();
    expect(screen.getByText("集团层级森严")).toBeInTheDocument();
    expect(screen.getAllByText(/资源受集团控制/).length).toBeGreaterThan(0);
  });

  it("加厚层与兜底都没有时显示空态", () => {
    render(<WorldbuildingCodexPanel projectPath={null} fallbackData={null} />);
    expect(screen.getByText(/还没有世界观/)).toBeInTheDocument();
  });

  it("显式 data（加厚层）优先于 fallbackData", () => {
    render(<WorldbuildingCodexPanel projectPath={null} data={thick} fallbackData={engineFallback} />);
    expect(screen.getByText("加厚层独有圈层")).toBeInTheDocument();
    expect(screen.queryByText("集团层级森严")).toBeNull();
  });
});
