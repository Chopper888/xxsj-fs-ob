import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type WorkerDisplayState = "RUNNING" | "STALLED" | "STOPPED" | "ERROR";

export interface WorkerTaskStatus {
  record_id_masked: string;
  platform: string;
  title: string;
  status: string;
  stage: string;
  stage_index: number;
  stage_total: number;
  started_at: string;
}

export interface WorkerStatus {
  schema_version: 1;
  worker_state: "running" | "stopped" | "error";
  pid: number;
  started_at: string;
  last_heartbeat_at: string;
  poll_interval_seconds: number;
  queue: { pending: number; processing: number; draft_ready: number; failed: number; retry_eligible: number };
  current_task: WorkerTaskStatus | null;
  last_completed: { title: string; finished_at: string; result: "done" } | null;
  last_error: { message: string; time: string } | null;
}

const writes = new Map<string, Promise<void>>();

export function workerStatusPath(root: string): string {
  return join(root, "data", "runtime", "worker-status.json");
}

export function maskRecordId(recordId: string): string {
  return recordId.length <= 7 ? "rec..." : `rec...${recordId.slice(-4)}`;
}

export function createInitialWorkerStatus(pid: number, pollIntervalSeconds: number, now = new Date()): WorkerStatus {
  const timestamp = now.toISOString();
  return {
    schema_version: 1,
    worker_state: "running",
    pid,
    started_at: timestamp,
    last_heartbeat_at: timestamp,
    poll_interval_seconds: pollIntervalSeconds,
    queue: { pending: 0, processing: 0, draft_ready: 0, failed: 0, retry_eligible: 0 },
    current_task: null,
    last_completed: null,
    last_error: null,
  };
}

async function writeAtomic(root: string, status: WorkerStatus): Promise<void> {
  const path = workerStatusPath(root);
  const dir = join(root, "data", "runtime");
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.worker-status.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function writeWorkerStatus(root: string, status: WorkerStatus): Promise<void> {
  const previous = writes.get(root) ?? Promise.resolve();
  const current = previous.then(() => writeAtomic(root, status));
  writes.set(root, current.catch(() => undefined));
  await current;
}

export async function readWorkerStatus(root: string): Promise<WorkerStatus | null> {
  try { return JSON.parse(await readFile(workerStatusPath(root), "utf8")) as WorkerStatus; }
  catch { return null; }
}

export async function updateWorkerStatus(root: string, patch: Partial<WorkerStatus>): Promise<WorkerStatus> {
  const current = await readWorkerStatus(root);
  if (!current) throw new Error("worker_status_unavailable");
  const next = { ...current, ...patch } as WorkerStatus;
  await writeWorkerStatus(root, next);
  return next;
}

export function classifyWorkerState(status: WorkerStatus | null, pidAlive: boolean, now = new Date()): WorkerDisplayState {
  if (!pidAlive) return "STOPPED";
  if (status?.worker_state === "error") return "ERROR";
  if (!status) return "STALLED";
  const heartbeatAge = now.getTime() - Date.parse(status.last_heartbeat_at);
  return !Number.isFinite(heartbeatAge) || heartbeatAge >= 60_000 ? "STALLED" : "RUNNING";
}
