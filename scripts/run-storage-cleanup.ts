import { resolve } from "node:path";
import { runStorageCleanup, taskDataDir } from "../src/worker/storageCleanup.js";

const root = resolve(import.meta.dirname, "..");
const execute = process.argv.includes("--execute");

await runStorageCleanup({
  dataDir: taskDataDir(root),
  mode: execute ? "execute" : "dry-run",
  logger: (line) => console.log(line),
});
