/**
 * 角色关系网模型（打磨E）：把角色 + 关系算成可直接渲染的节点坐标 + 连线端点/配色/标签。
 * 纯函数、确定性（主角居中、其余环绕的圆形布局），便于单测；SVG 渲染只做无脑映射。
 */
export interface GraphCharacterInput {
  readonly id: string;
  readonly name: string;
  readonly role: string;
}

/** 关系输入：以主角为隐含起点指向 target；pairFrom/pairWith 为做厚后的显式双端（可选）。 */
export interface GraphRelationshipInput {
  readonly targetCharacterId?: string;
  readonly targetName?: string;
  readonly relationType?: string;
  readonly attitude?: string;
  readonly trustLevel?: "low" | "medium" | "high";
  readonly pairFrom?: string;
  readonly pairWith?: string;
}

export interface GraphNode {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly x: number;
  readonly y: number;
  readonly isProtagonist: boolean;
}

export interface GraphEdge {
  readonly key: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly mx: number;
  readonly my: number;
  readonly trustClass: "trust-low" | "trust-mid" | "trust-high";
  readonly label: string;
}

export interface CharacterGraphModel {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

function t(value?: string): string {
  return value?.trim() ?? "";
}

function trustClassOf(level?: "low" | "medium" | "high"): GraphEdge["trustClass"] {
  return level === "low" ? "trust-low" : level === "high" ? "trust-high" : "trust-mid";
}

export function buildCharacterGraphModel(
  characters: readonly GraphCharacterInput[],
  relationships: readonly GraphRelationshipInput[],
  dims: { readonly width: number; readonly height: number } = { width: 820, height: 460 },
  /** 权威主角名（来自 ProtagonistStatus.name）；传了就按名字定中心，避免被职能描述里含「主角」二字的配角骗。 */
  protagonistName?: string,
): CharacterGraphModel {
  const { width, height } = dims;
  const cx = width / 2;
  const cy = height / 2;
  const leadName = t(protagonistName);
  const protagonist =
    (leadName ? characters.find((c) => t(c.name) === leadName) : undefined) ??
    characters.find((c) => c.role.includes("主角")) ??
    characters[0];
  const others = characters.filter((c) => c.id !== protagonist?.id);
  const rx = Math.min(330, 150 + others.length * 10);
  const ry = 165;

  const pos = new Map<string, { readonly x: number; readonly y: number }>();
  const place = (c: GraphCharacterInput, x: number, y: number): void => {
    pos.set(c.id, { x, y });
    const name = t(c.name);
    if (name) pos.set(name, { x, y });
  };
  if (protagonist) place(protagonist, cx, cy);
  others.forEach((c, i) => {
    const a = ((-90 + (360 * i) / Math.max(1, others.length)) * Math.PI) / 180;
    place(c, cx + rx * Math.cos(a), cy + ry * Math.sin(a));
  });

  const resolve = (idOrName?: string): { readonly x: number; readonly y: number } | undefined => {
    const key = t(idOrName);
    return key ? pos.get(key) : undefined;
  };

  const nodes: GraphNode[] = characters
    .map((c) => {
      const p = pos.get(c.id);
      if (!p) return null;
      return { id: c.id, name: t(c.name) || "未命名角色", role: c.role, x: p.x, y: p.y, isProtagonist: c.id === protagonist?.id };
    })
    .filter((n): n is GraphNode => n !== null);

  const edges: GraphEdge[] = [];
  relationships.forEach((r, i) => {
    const from = resolve(r.pairFrom) ?? (protagonist ? pos.get(protagonist.id) : undefined);
    const to = resolve(r.targetCharacterId) ?? resolve(r.targetName) ?? resolve(r.pairWith);
    if (!from || !to) return;
    if (from.x === to.x && from.y === to.y) return; // 自指/未解析到不同端点 → 跳过
    edges.push({
      key: `edge-${i}`,
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      mx: (from.x + to.x) / 2,
      my: (from.y + to.y) / 2,
      trustClass: trustClassOf(r.trustLevel),
      label: (t(r.relationType) || t(r.attitude)).slice(0, 6),
    });
  });

  return { width, height, nodes, edges };
}
