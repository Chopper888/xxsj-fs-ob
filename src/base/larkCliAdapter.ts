import { execSync } from "node:child_process";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const BASE_FIELD_NAMES = [
  "标题", "原文链接", "来源平台", "作者", "日期", "一级标签", "概述",
  "二级标签", "去重ID", "处理状态", "备注", "重试次数", "最近错误",
  "处理时间", "知识库路径", "收藏时间",
];

export function resolveLarkIdentity(value: string | undefined): "bot" | "user" {
  return value?.trim().toLowerCase() === "user" ? "user" : "bot";
}

export function resolveLarkCliBin(value: string | undefined): string {
  return value?.trim() || "lark-cli";
}

export class LarkCliAdapter {
  private profile: string;
  constructor(
    private baseToken: string,
    private tableId: string,
    private dataDir: string,
  ) {
    this.profile = process.env.LARK_PROFILE || "";
  }

  private exec(args: string[], stdin?: string): any {
    const profileFlag = this.profile ? ` --profile ${this.profile}` : "";
    const identity = resolveLarkIdentity(process.env.LARK_IDENTITY);
    const larkCli = resolveLarkCliBin(process.env.LARK_CLI_BIN);
    const cmd = `"${larkCli}"${profileFlag} base ${args.join(" ")} --as ${identity} --base-token ${this.baseToken} --table-id ${this.tableId}`;
    const opts: any = { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, shell: true, timeout: 30000 };
    if (stdin) opts.input = stdin;
    try {
      const raw = execSync(cmd, opts);
      return JSON.parse(raw.trim());
    } catch (e: any) {
      if (e.killed || e.code === "ETIMEDOUT") throw new Error("lark_timeout");
      if (e.status === 1) {
        try { const j = JSON.parse(e.stdout?.trim() || e.stderr?.trim() || "{}"); if (!j.ok) throw new Error("lark:" + (j.error?.code ?? "unknown") + ":" + (j.error?.message ?? "").slice(0, 100)); } catch (pe: any) { if (pe.message?.startsWith("lark:")) throw pe; }
      }
      throw new Error("lark_exec_failed:" + (e.message ?? "").slice(0, 100));
    }
  }

  async recordGet(recordId: string): Promise<{ record: { fields: Record<string,unknown> } }> {
    const j = this.exec(["+record-get", "--record-id", recordId, "--format", "json"]);
    const fields = j.data?.fields as string[] | undefined;
    const rows = j.data?.data as unknown[][] | undefined;
    if (!fields || !rows || !rows.length) throw new Error("lark:unexpected_get_format");
    const record: Record<string,unknown> = {};
    for (let i = 0; i < fields.length; i++) record[fields[i]] = rows[0][i];
    return { record: { fields: record } };
  }

  recordList(): Array<{ record_id: string; fields: Record<string,unknown> }> {
    const j = this.exec(["+record-list", "--page-size", "50", "--format", "json"]);
    if (Array.isArray(j.data?.items)) return j.data.items;
    const fields = j.data?.fields as string[] | undefined;
    const rows = j.data?.data as unknown[][] | undefined;
    const recordIds = j.data?.record_id_list as string[] | undefined;
    if (!fields) throw new Error("lark:unexpected_list_format");
    return (rows ?? []).map((row, rowIndex) => {
      const f: Record<string,unknown> = {};
      for (let i = 0; i < fields.length; i++) f[fields[i]] = row[i];
      const rid = recordIds?.[rowIndex] ?? "";
      return { record_id: rid, fields: f };
    });
  }

  async recordUpsert(recordId: string, fields: Record<string,unknown>): Promise<void> {
    // Validate fields
    for (const key of Object.keys(fields)) {
      if (!BASE_FIELD_NAMES.includes(key)) throw new Error("base_field_not_found:" + key);
    }
    // Write JSON to temp file (lark-cli requires @file with relative path)
    const tmpName = ".lark-" + randomUUID().slice(0, 8) + ".json";
    const tmpPath = join(this.dataDir, tmpName);
    const json = JSON.stringify(fields);
    await writeFile(tmpPath, json, "utf8");
    try {
      this.exec(["+record-upsert", "--record-id", recordId, "--json", "@data/" + tmpName, "--format", "json"]);
    } finally {
      try { await unlink(join(this.dataDir, tmpName)); } catch {}
    }
  }

  validateFields(fields: Record<string,unknown>): void {
    for (const key of Object.keys(fields)) {
      if (!BASE_FIELD_NAMES.includes(key)) throw new Error("base_field_not_found:" + key);
    }
  }

  static validateRecordId(recordId: string): string {
    if (!recordId || recordId.length < 10) throw new Error("record_id_too_short");
    if (/[^a-zA-Z0-9]/.test(recordId)) throw new Error("record_id_invalid_chars");
    return recordId;
  }
}
