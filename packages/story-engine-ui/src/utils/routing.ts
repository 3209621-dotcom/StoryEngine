type WorkspaceRoute =
  | { readonly type: "home" }
  | { readonly type: "book"; readonly bookId: string }
  | { readonly type: "project"; readonly projectPath: string };

export function readWorkspaceRoute(): WorkspaceRoute {
  const bookMatch = window.location.pathname.match(/^\/books\/([^/]+)\/workspace\/?$/u);
  if (bookMatch?.[1]) {
    return { type: "book", bookId: decodeURIComponent(bookMatch[1]) };
  }

  if (window.location.pathname === "/workspace") {
    const projectPath = new URLSearchParams(window.location.search).get("project")?.trim();
    if (projectPath) return { type: "project", projectPath };
  }

  return { type: "home" };
}

export function pushWorkspaceUrlForBook(bookId: string): void {
  window.history.pushState(null, "", `/books/${encodeURIComponent(bookId)}/workspace`);
}

export function pushWorkspaceUrlForProject(projectPath: string): void {
  const params = new URLSearchParams({ project: projectPath });
  window.history.pushState(null, "", `/workspace?${params.toString()}`);
}

export function pushHomeUrl(): void {
  window.history.pushState(null, "", "/");
}
