import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface PersistedState {
  processedIds: string[];
  processedRecordIds?: Record<string, string>;
  lastScanAt?: string;
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export class LocalStateStore {
  private readonly statePath: string;
  private readonly pendingPath: string;

  constructor(private readonly rootDir: string) {
    this.statePath = join(rootDir, "state.json");
    this.pendingPath = join(rootDir, "pending-records.jsonl");
  }

  async ensure(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async load(): Promise<PersistedState> {
    await this.ensure();
    return readJsonFile<PersistedState>(this.statePath, { processedIds: [] });
  }

  async save(state: PersistedState): Promise<void> {
    await this.ensure();
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  async isProcessed(dedupeId: string): Promise<boolean> {
    const state = await this.load();
    return state.processedIds.includes(dedupeId);
  }

  async getProcessedRecordId(dedupeId: string): Promise<string | undefined> {
    const state = await this.load();
    return state.processedRecordIds?.[dedupeId];
  }

  async markProcessed(dedupeId: string, recordId?: string): Promise<void> {
    const state = await this.load();
    if (!state.processedIds.includes(dedupeId)) {
      state.processedIds.push(dedupeId);
    }
    if (recordId) {
      state.processedRecordIds = {
        ...(state.processedRecordIds ?? {}),
        [dedupeId]: recordId,
      };
    }
    state.lastScanAt = new Date().toISOString();
    await this.save(state);
  }

  async appendPending(record: unknown): Promise<void> {
    await this.ensure();
    await appendFile(this.pendingPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async readPending(): Promise<unknown[]> {
    await this.ensure();
    try {
      const content = await readFile(this.pendingPath, "utf8");
      return content
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
