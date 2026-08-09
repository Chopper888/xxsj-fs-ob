import { join, posix, win32 } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

export interface EligibilityOptions {
  retryFailed: boolean;
  force: boolean;
}

export function baseCellValuesEqual(actual: unknown, expected: unknown): boolean {
  if (expected === "" && (actual === undefined || actual === null || actual === "")) return true;
  return JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);
}

export interface BaseAttemptSnapshotInput {
  taskDir: string;
  recordId: string;
  attempt: number;
  createdAt?: Date;
  fields: Record<string, unknown>;
}

export async function writeBaseAttemptSnapshot(input: BaseAttemptSnapshotInput): Promise<string> {
  const createdAt = input.createdAt ?? new Date();
  const timestamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const snapshotDir = join(input.taskDir, "snapshots");
  await mkdir(snapshotDir, { recursive: true });
  const payload = {
    recordId: input.recordId,
    attempt: input.attempt,
    createdAt: createdAt.toISOString(),
    currentStatus: input.fields["处理状态"] ?? null,
    retryCount: input.fields["重试次数"] ?? 0,
    recentError: input.fields["最近错误"] ?? null,
    processingTime: input.fields["处理时间"] ?? null,
    fields: input.fields,
  };
  for (let sequence = 0; sequence < 100; sequence += 1) {
    const suffix = sequence === 0 ? "" : `-${String(sequence + 1).padStart(2, "0")}`;
    const path = join(snapshotDir, `base-snapshot-attempt-${String(input.attempt).padStart(2, "0")}-${timestamp}${suffix}.json`);
    try {
      await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("snapshot_unique_name_exhausted");
}

export function normalizeTaskDedupeId(dedupeId: string, sourceUrl: string): string {
  const workId = sourceUrl.match(/(?:\/video\/|[?&]modal_id=)(\d{8,})/)?.[1]
    ?? dedupeId.match(/(\d{8,})/)?.[1];
  return workId ? `douyin:${workId}` : dedupeId.trim();
}

export function assertTaskEligible(status: string, options: EligibilityOptions): void {
  if (options.force) return;
  if (status === "pending") return;
  if (status === "failed") {
    if (options.retryFailed) return;
    throw new Error("failed_requires_retry_failed");
  }
  throw new Error(`status_refused:${status}`);
}

export function resolveWhisperPython(platform: NodeJS.Platform, projectRoot: string): string {
  return platform === "win32"
    ? win32.join(projectRoot, ".venv", "Scripts", "python.exe")
    : posix.join(projectRoot, ".venv", "bin", "python");
}

export function resolveConfiguredWhisperPython(
  configured: string | undefined,
  platform: NodeJS.Platform,
  projectRoot: string,
): string {
  if (!configured?.trim()) return resolveWhisperPython(platform, projectRoot);
  const paths = platform === "win32" ? win32 : posix;
  const normalized = configured.trim().replace(platform === "win32" ? /\//g : /\\/g, platform === "win32" ? "\\" : "/");
  return paths.isAbsolute(normalized) ? normalized : paths.resolve(projectRoot, normalized);
}

export interface DryRunInput {
  recordId: string;
  sourceUrl: string;
  status: string;
  dedupeId: string;
  projectRoot: string;
  pythonPath: string;
}

export function buildDryRunPlan(input: DryRunInput) {
  const taskDir = join(input.projectRoot, "data", "tasks", input.recordId);
  return {
    recordId: input.recordId,
    sourceUrl: input.sourceUrl,
    currentStatus: input.status,
    normalizedDedupeId: normalizeTaskDedupeId(input.dedupeId, input.sourceUrl),
    parserPath: "detail_api_then_playwright_profile_fallback",
    taskDir,
    mediaPath: join(taskDir, "media", "source.mp4"),
    temporaryDir: join(taskDir, "tmp"),
    pythonPath: input.pythonPath,
    expectedStateChanges: [input.status, "processing", "draft_ready"],
  };
}
