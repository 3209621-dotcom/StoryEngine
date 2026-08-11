/**
 * 路由测试公共 fixture：callRoute（伪 IncomingMessage/ServerResponse 调用注册的中间件）
 * 与 makeMinimalProject（最小合法 StoryEngine 项目骨架）。
 * 仅供新测试使用；既有测试文件保留各自的本地实现。
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Middleware, MiddlewareStack } from "../lib/project-io.js";

export interface RouteCallResult {
  readonly statusCode: number;
  readonly payload: Record<string, unknown>;
}

/** 调一个路由注册器下的处理器，返回状态码和 JSON payload。 */
export async function callRoute(
  register: (middlewares: MiddlewareStack) => void,
  method: "GET" | "POST" | "PUT",
  url: string,
  body?: Record<string, unknown>,
): Promise<RouteCallResult> {
  const handlers: Middleware[] = [];
  register({ use: (handler) => handlers.push(handler) });
  const handler = handlers[0];
  if (!handler) throw new Error("route handler was not registered");

  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const req = Object.assign(Readable.from(rawBody ? [Buffer.from(rawBody)] : []), {
    method,
    url,
  }) as IncomingMessage;

  const chunks: Buffer[] = [];
  const res = {
    statusCode: 200,
    setHeader: () => res as unknown as ServerResponse,
    end: (chunk?: string | Buffer) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return res as unknown as ServerResponse;
    },
  } as unknown as ServerResponse;

  await new Promise<void>((resolve, reject) => {
    const result = handler(req, res, (error?: unknown) => (error ? reject(error) : resolve())) as unknown;
    Promise.resolve(result).then(() => resolve(), reject);
  });

  const payload = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
  return { statusCode: res.statusCode, payload };
}

/** 在 rootDir 下建一个能通过 guardProjectPath/assertStoryEngineProject 的最小项目。 */
export async function makeMinimalProject(rootDir: string, title = "测试书"): Promise<string> {
  const dir = await mkdtemp(join(rootDir, "p-"));
  await Promise.all([
    mkdir(join(dir, "story"), { recursive: true }),
    mkdir(join(dir, "timeline"), { recursive: true }),
    mkdir(join(dir, "world"), { recursive: true }),
    mkdir(join(dir, "characters"), { recursive: true }),
  ]);
  await writeFile(join(dir, "project.json"), `${JSON.stringify({ title }, null, 2)}\n`, "utf-8");
  return dir;
}
