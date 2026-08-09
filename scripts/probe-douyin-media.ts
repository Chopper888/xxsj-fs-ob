import { join } from "node:path";
import { captureDouyinMediaWithBrowser, normalizeDouyinVideoUrl } from "../src/media/douyinMediaCapture.js";

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) throw new Error("usage: tsx scripts/probe-douyin-media.ts <douyin-url>");

  const target = normalizeDouyinVideoUrl(input);
  const outputPath = join("data", "media", `douyin_${target.id}.mp4`);

  const result = await captureDouyinMediaWithBrowser(
    {
      inputUrl: input,
      outputPath,
      userDataDir: ".browser/douyin",
    },
    (kind) => console.log(`media_candidate_found:${kind}`),
  );
  console.log(`media_downloaded:${result.outputPath}:${result.bytes}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`probe_failed:${message}`);
  process.exitCode = 1;
});
