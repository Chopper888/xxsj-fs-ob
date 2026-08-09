import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CaptureRecord } from "../domain/types.js";

export type VideoJobStatus = "pending" | "processing" | "done" | "failed";

export interface VideoJob {
  dedupeId: string;
  feishuRecordId?: string;
  url: string;
  title: string;
  author?: string;
  capturedAt: string;
  record: CaptureRecord;
  status: VideoJobStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  transcriptPath?: string;
  mediaPath?: string;
  audioPath?: string;
}

function isRetryableVideoJobFailure(job: VideoJob): boolean {
  if (job.status !== "failed") return false;
  return (
    job.errorMessage?.includes("Target page, context or browser has been closed") ||
    job.errorMessage?.includes("Browser context has been closed") ||
    false
  );
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export class VideoJobStore {
  private readonly jobsPath: string;

  constructor(private readonly rootDir: string) {
    this.jobsPath = join(rootDir, "video-jobs.json");
  }

  async ensure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async readJobs(): Promise<VideoJob[]> {
    await this.ensure();
    return readJsonFile<VideoJob[]>(this.jobsPath, []);
  }

  async saveJobs(jobs: VideoJob[]): Promise<void> {
    await this.ensure();
    await writeFile(this.jobsPath, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  }

  async enqueue(record: CaptureRecord): Promise<"enqueued" | "skipped"> {
    if (record.type !== "video" || !record.url) return "skipped";

    const jobs = await this.readJobs();
    const existing = jobs.find((job) => job.dedupeId === record.dedupeId);
    if (existing && existing.status !== "failed") return "skipped";

    const now = new Date().toISOString();
    const job: VideoJob = {
      dedupeId: record.dedupeId,
      feishuRecordId: record.feishuRecordId ?? existing?.feishuRecordId,
      url: record.url,
      title: record.title,
      author: record.author,
      capturedAt: record.capturedAt,
      record,
      status: "pending",
      attempts: existing ? existing.attempts : 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existing) {
      const index = jobs.indexOf(existing);
      jobs[index] = job;
    } else {
      jobs.push(job);
    }
    await this.saveJobs(jobs);
    return "enqueued";
  }

  async nextPending(): Promise<VideoJob | undefined> {
    const jobs = await this.readJobs();
    return jobs.find((job) => job.status === "pending" || isRetryableVideoJobFailure(job));
  }

  async update(updated: VideoJob): Promise<void> {
    const jobs = await this.readJobs();
    const index = jobs.findIndex((job) => job.dedupeId === updated.dedupeId);
    if (index === -1) {
      jobs.push(updated);
    } else {
      jobs[index] = updated;
    }
    await this.saveJobs(jobs);
  }
}
