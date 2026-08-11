import {
  readMemoryRuntimeMinimal,
  type MemoryReadRuntimeLimits,
  type MemoryReadRuntimeResult,
} from "./memory-read-runtime.js";
import type { MemoryReadViewModel } from "./memory-read-viewmodel.js";

export type MemoryContextRuntimeAdapterStatus = "idle" | "loading" | "ready" | "warning" | "blocked" | "failed";

export interface MemoryContextRuntimeAdapterInput {
  readonly projectRoot: string;
  readonly memoryTargetPath: string;
  readonly limits?: Partial<MemoryReadRuntimeLimits>;
  readonly enabled?: boolean;
  readonly displayContext?: {
    readonly projectName?: string;
    readonly chapterId?: string;
    readonly requestId?: string;
  };
}

export interface MemoryContextRuntimeAdapterResult {
  readonly status: MemoryContextRuntimeAdapterStatus;
  readonly viewModel: MemoryReadViewModel | null;
  readonly warnings: readonly string[];
  readonly blockingReasons: readonly string[];
  readonly sourcePath: string | null;
  readonly normalizedPath: string;
  readonly readOnly: true;
  readonly canWrite: false;
  readonly canInjectAutomatically: false;
  readonly didReadFile: boolean;
  readonly didWriteMemory: false;
  readonly didInjectAutomatically: false;
}

const IDLE_RESULT: MemoryContextRuntimeAdapterResult = {
  status: "idle",
  viewModel: null,
  warnings: [],
  blockingReasons: [],
  sourcePath: null,
  normalizedPath: "",
  readOnly: true,
  canWrite: false,
  canInjectAutomatically: false,
  didReadFile: false,
  didWriteMemory: false,
  didInjectAutomatically: false,
};

export async function loadMemoryContextRuntimeAdapter(
  input: MemoryContextRuntimeAdapterInput,
): Promise<MemoryContextRuntimeAdapterResult> {
  if (input.enabled === false) {
    return IDLE_RESULT;
  }

  try {
    const runtimeResult = await readMemoryRuntimeMinimal({
      projectRoot: input.projectRoot,
      targetPath: input.memoryTargetPath,
      limits: input.limits,
    });

    return toAdapterResult(runtimeResult);
  } catch (error) {
    return {
      status: "failed",
      viewModel: null,
      warnings: [`memory context adapter warning: ${errorMessage(error)}`],
      blockingReasons: [],
      sourcePath: null,
      normalizedPath: "",
      readOnly: true,
      canWrite: false,
      canInjectAutomatically: false,
      didReadFile: false,
      didWriteMemory: false,
      didInjectAutomatically: false,
    };
  }
}

function toAdapterResult(runtimeResult: MemoryReadRuntimeResult): MemoryContextRuntimeAdapterResult {
  const hasBlockingReasons = runtimeResult.blockingReasons.length > 0;
  const hasWarnings = runtimeResult.warnings.length > 0;

  return {
    status: hasBlockingReasons ? "blocked" : hasWarnings ? "warning" : runtimeResult.ok ? "ready" : "failed",
    viewModel: hasBlockingReasons || !runtimeResult.ok ? null : runtimeResult.viewModel,
    warnings: runtimeResult.warnings,
    blockingReasons: runtimeResult.blockingReasons,
    sourcePath: runtimeResult.sourcePath,
    normalizedPath: runtimeResult.normalizedPath,
    readOnly: true,
    canWrite: false,
    canInjectAutomatically: false,
    didReadFile: runtimeResult.didReadFile,
    didWriteMemory: false,
    didInjectAutomatically: false,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
