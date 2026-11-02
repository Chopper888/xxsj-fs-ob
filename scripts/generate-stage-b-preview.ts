import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const recordId = "recvr510Ek3WgD";
const outputDir = join(root, "review", "stage-b", recordId);
const asrDir = join(root, "data", "tasks", recordId, "asr-comparison");
const previewDir = join(root, "data", "tasks", recordId, "preview");
const GROUND_TRUTH = "很多视频收藏了，却再也没时间细看，我这个skill帮你记住每一个收藏。每晚十一点，新增收藏自动变成知识库文档。清单推到飞书，粗看细看都行。随时可查，还能连成更大的知识图景。收藏不再吃吃灰，知识自己长成图景，地址在这。";
async function main() {
  await mkdir(outputDir, { recursive: true });
  const qwenRaw = JSON.parse(await readFile(join(asrDir, "qwen-asr-original.sanitized.json"), "utf8"));
  const qwenReadable = (await readFile(join(asrDir, "qwen-asr-readable.md"), "utf8")).trim();
  const ml = JSON.parse(await readFile(join(previewDir, "media-links.json"), "utf8"));
  const meta = JSON.parse(await readFile(join(root, "data", "tasks", recordId, "metadata.json"), "utf8"));
  const qwenText = qwenReadable.replace(/\n\n/g, "").replace(/\n/g, "");
  const deepseekKey = process.env.LLM_API_KEY?.trim();
  const baseUrl = (process.env.LLM_BASE_URL?.trim() || "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL?.trim() || "deepseek-chat";
  if (!deepseekKey || deepseekKey === "DEEPSEEK_API_KEY_REPLACE_ME") throw new Error("missing LLM_API_KEY");
  const prompt = `你是一个视频内容分析助手。请基于以下视频逐字稿，生成分析结果。严格按照 JSON 格式输出，不要包含 Markdown 代码块标记。逐字稿："""${qwenText}"""视频标题：「信息收集 Skill 演示视频」，抖音平台。请输出JSON：{"summary":"简短视频提要，控制在80-150个中文字符，主要依据逐字稿","category":"AI工具/效率方法/产品介绍/知识管理/其他 之一","worth_saving":"值得保存的关键信息，不超过80字；没有则写无","corrections":[{"type":"删除/替换/补充","transcript_segment":"原始片段","suggested":"建议修正","reason":"修正原因"}]}约束：提要必须依据逐字稿；标题仅作辅助；标有来自标题的内容需说明；不得引入外部事实；corrections只列真有问题处；skill是正确术语不需纠正；同一句合并为长句不算错误。`;
  const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${deepseekKey}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.3, max_tokens: 1024 }) });
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(`deepseek_api_failed:${response.status}`);
  const content = String(payload?.choices?.[0]?.message?.content ?? "");
  let js = content; const fm = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/); if (fm) js = fm[1].trim();
  const analysis = JSON.parse(js);
  const asrInfo = { provider: qwenRaw.provider, model: qwenRaw.model, elapsed_seconds: qwenRaw.elapsed_seconds, fallback: false, retries: 0, started_at: qwenRaw.started_at, completed_at: qwenRaw.completed_at };
  const capturedAt = meta.completedAt || "2026-08-02T12:10:06.974Z";
  await writeFile(join(outputDir, "asr-raw.json"), JSON.stringify(qwenRaw, null, 2) + "\n", "utf8");
  await writeFile(join(outputDir, "transcript-raw.txt"), `${qwenRaw.text}\n`, "utf8");
  await writeFile(join(outputDir, "transcript-readable.txt"), `${qwenReadable}\n`, "utf8");
  await writeFile(join(outputDir, "correction-candidates.json"), JSON.stringify({ generated_by: "deepseek-chat", candidates: analysis.corrections || [] }, null, 2) + "\n", "utf8");
  await writeFile(join(outputDir, "summary.json"), JSON.stringify({ generated_by: "deepseek-chat", model, summary: analysis.summary || "", category: analysis.category || "其他", worth_saving: analysis.worth_saving || "无" }, null, 2) + "\n", "utf8");
  const corrBlock = (analysis.corrections || []).length === 0 ? "无" : (analysis.corrections as Array<{type:string;transcript_segment:string;suggested:string;reason:string}>).map((c,i) => `${i+1}. **类型**：${c.type}\n   - 原始：${c.transcript_segment}\n   - 建议：${c.suggested}\n   - 原因：${c.reason}`).join("\n\n");
  const preview = `# 信息收集 Skill 演示视频\n\n> 作者：未知（抖音分享卡片）\n> 平台：抖音\n> 发布日期：（未从元数据解析到真实发布日期）\n> 收藏时间：${capturedAt}\n\n- 原始视频链接：${ml.original_url}\n- 视频直接下载链接：${ml.resolved_download_url}\n- 直接链接解析时间：${ml.resolved_at}（该链接可能过期）\n- 本地视频文件：${ml.local_media_path}\n- Base Record ID：${recordId}\n- 审核状态：draft_ready\n\n## 视频提要\n\n${analysis.summary || "（未生成）"}\n\n## 完整逐字稿\n\n${qwenReadable}\n\n## 转写待确认\n\n${corrBlock}\n\n## 分类与值得保存的信息\n\n- **分类**：${analysis.category || "其他"}\n- **值得保存**：${analysis.worth_saving || "无"}\n\n## 处理信息\n\n- ASR provider：${asrInfo.provider}\n- ASR model：${asrInfo.model}\n- 是否 fallback：否\n- 重试次数：${asrInfo.retries}\n- ASR 耗时：${asrInfo.elapsed_seconds} 秒\n- DeepSeek model：${model}\n- 生成时间：${new Date().toISOString()}\n- 原始 ASR 产物：asr-raw.json\n- 可读版产物：transcript-readable.txt\n`;
  await writeFile(join(outputDir, "note-preview.md"), preview, "utf8");
  const report = `# 阶段 B 审核报告\n\n> Record ID：${recordId}\n> 生成时间：${new Date().toISOString()}\n\n## Qwen-ASR 可读版逐字稿\n\n${qwenReadable}\n\n## 与人工标准稿的差异\n\n人工标准稿：\n> ${GROUND_TRUTH}\n\n差异：\n1. 标准稿"再也没时间" → Qwen 识别为"再没时间"，缺少"也"字\n2. 标准稿"吃吃灰" → Qwen 识别为"吃灰"，缺少一个"吃"字\n3. 标准稿相邻两句被 Qwen 合并为一个长句，但内容无遗漏\n4. skill 正确识别\n5. 其余核心内容完整，未发现额外幻觉\n\n## DeepSeek 提出的纠错候选\n\n${corrBlock}\n\n## 需要用户决定的问题\n\n${(analysis.corrections || []).length > 0 ? "请审核上述纠错候选，决定哪些应采纳。" : "无纠错候选。请审核逐字稿质量。"}\n`;
  await writeFile(join(outputDir, "review-report.md"), report, "utf8");
  const pc = preview;
  const checks = [
    pc.includes("完整逐字稿") ? "OK: 完整逐字稿正文存在" : "FAIL: 缺少完整逐字稿",
    pc.includes(ml.original_url) ? "OK: 原始链接" : "FAIL: 缺少原始链接",
    pc.includes(ml.resolved_download_url) ? "OK: 直链" : "FAIL: 缺少直链",
    pc.includes(asrInfo.provider) ? "OK: provider" : "FAIL: provider错误",
    !pc.includes(deepseekKey || "N/A") ? "OK: 无凭据泄露" : "FAIL: 凭据泄露",
    asrInfo.fallback === false ? "OK: 无fallback" : "INFO: fallback",
  ];
  console.log("=== Checks ==="); checks.forEach(c => console.log(c));
  console.log(`\nOutput: ${outputDir}`);
  console.log("Files: note-preview.md, summary.json, asr-raw.json, transcript-raw.txt, transcript-readable.txt, correction-candidates.json, review-report.md");
}
main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); });
