import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = join(packageRoot, "src");

const forbiddenFragments = [
  "commit-engine",
  "fast-draft-writer",
  "review-plan",
  "maintenance",
  "apply-review-plan",
];

const errors = [];

for (const filePath of collectSourceFiles(sourceRoot)) {
  const normalizedPath = normalize(filePath);
  const text = readFileSync(filePath, "utf8");
  const importStatements = findImports(text);
  const storyEngineImports = importStatements.filter((statement) => statement.source === "@actalk/story-engine");

  for (const statement of importStatements) {
    const inspected = `${statement.clause} ${statement.source}`;
    const blocked = forbiddenFragments.find((fragment) => inspected.includes(fragment));
    if (blocked) {
      errors.push(`${formatPath(filePath)} imports forbidden UI boundary fragment: ${blocked}`);
    }
  }

  // 只拦会进运行时 bundle 的 value import；`import type {...}` 编译期被 erase、不进 bundle，
  // 不破坏「前端 bundle 不含 engine 服务端代码」的边界（重型 server 模块仍由上面的 forbiddenFragments 兜底，连 type 都拦）。
  const storyEngineValueImports = storyEngineImports.filter((statement) => !isTypeOnlyImport(statement.clause));
  if (storyEngineValueImports.length > 0 && !isServerFile(normalizedPath)) {
    errors.push(`${formatPath(filePath)} must not import @actalk/story-engine directly`);
  }
}

if (errors.length > 0) {
  console.error("UI import boundary check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("UI import boundary check passed.");

function collectSourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) return [fullPath];
    return [];
  });
}

function findImports(text) {
  const imports = [];
  const staticImportPattern = /(?:^|\n)\s*import\s+(?!["'])([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g;
  const sideEffectImportPattern = /(?:^|\n)\s*import\s+["']([^"']+)["'];?/g;
  const dynamicImportPattern = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

  for (const match of text.matchAll(staticImportPattern)) {
    imports.push({ clause: match[1].trim(), source: match[2] });
  }

  for (const match of text.matchAll(sideEffectImportPattern)) {
    imports.push({ clause: "side-effect import", source: match[1] });
  }

  for (const match of text.matchAll(dynamicImportPattern)) {
    imports.push({ clause: "dynamic import", source: match[1] });
  }

  return imports;
}

function formatPath(filePath) {
  return relative(packageRoot, filePath);
}

function normalize(filePath) {
  return filePath.split(sep).join("/");
}

function isServerFile(normalizedPath) {
  return normalizedPath.includes("/src/server/");
}

// 纯类型导入 `import type { ... }` / `import type Foo` / `import type * as X`：clause 以 `type` 开头。
// 这类导入编译期被 erase，不进运行时 bundle。注意只放行整句 `import type`，不放行 inline 的
// `import { type A, value B }`（那种 clause 以 `{` 开头、含 value import，仍按 value 拦截）。
function isTypeOnlyImport(clause) {
  return /^type\b/.test(clause.trim());
}
