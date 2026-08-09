import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStateStore } from "../../src/state/localState.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "douyin-capture-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("LocalStateStore", () => {
  it("tracks processed ids", async () => {
    const store = new LocalStateStore(dir);
    expect(await store.isProcessed("a")).toBe(false);

    await store.markProcessed("a", "rec_a");
    expect(await store.isProcessed("a")).toBe(true);
    expect(await store.getProcessedRecordId("a")).toBe("rec_a");
  });

  it("stores pending records as jsonl", async () => {
    const store = new LocalStateStore(dir);
    await store.appendPending({ dedupeId: "x", title: "Example" });

    const pending = await store.readPending();
    expect(pending).toEqual([{ dedupeId: "x", title: "Example" }]);
  });
});
