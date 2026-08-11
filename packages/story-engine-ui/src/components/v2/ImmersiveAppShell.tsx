import type { HomePageProps, WritingWorkspaceLayoutProps } from "../../types.js";
import WritingWorkspaceCodex from "./codex/WritingWorkspaceCodex.js";
import HomeLanding from "./HomeLanding.js";

export default function ImmersiveAppShell(props:
  | { readonly mode: "home"; readonly home: HomePageProps }
  | { readonly mode: "workspace"; readonly workspace: WritingWorkspaceLayoutProps }
) {
  if (props.mode === "home") {
    return <HomeLanding {...props.home} />;
  }
  return <WritingWorkspaceCodex {...props.workspace} />;
}
