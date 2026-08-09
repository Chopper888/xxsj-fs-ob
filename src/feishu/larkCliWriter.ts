import { execFile as nodeExecFile } from "node:child_process";

type ExecFile = typeof nodeExecFile;

interface LarkCliFeishuWriterOptions {
  baseToken: string;
  tableId: string;
  execFileImpl?: ExecFile;
}

export interface FeishuWriteOptions {
  recordId?: string;
  lookupDedupeId?: string;
  createIfMissing?: boolean;
  updateFieldsIfExisting?: Record<string, unknown>;
}

export interface FeishuWriteResult {
  recordId?: string;
  matchedExisting?: boolean;
}

export class LarkCliFeishuWriter {
  private readonly execFileImpl: ExecFile;

  constructor(private readonly options: LarkCliFeishuWriterOptions) {
    this.execFileImpl = options.execFileImpl ?? nodeExecFile;
  }

  private execLarkCli(args: string[], errorMessage: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.execFileImpl("lark-cli", args, (error, stdout) => {
        if (error) {
          reject(new Error(errorMessage));
          return;
        }
        resolve(String(stdout || "{}"));
      });
    });
  }

  private async queryRecordList(args: string[]): Promise<unknown> {
    const stdout = await this.execLarkCli(args, "feishu_lookup_failed");
    try {
      return JSON.parse(stdout || "{}") as unknown;
    } catch {
      throw new Error("feishu_lookup_parse_failed");
    }
  }

  async findRecordIdByDedupeId(dedupeId: string, options: { retry?: boolean } = {}): Promise<string | undefined> {
    const searchArgs = [
      "base",
      "+record-search",
      "--as",
      "user",
      "--base-token",
      this.options.baseToken,
      "--table-id",
      this.options.tableId,
      "--keyword",
      dedupeId,
      "--search-field",
      "去重 ID",
      "--field-id",
      "去重 ID",
      "--limit",
      "10",
      "--format",
      "json",
    ];
    const args = [
      "base",
      "+record-list",
      "--as",
      "user",
      "--base-token",
      this.options.baseToken,
      "--table-id",
      this.options.tableId,
      "--field-id",
      "去重 ID",
      "--filter-json",
      JSON.stringify({ logic: "and", conditions: [["去重 ID", "==", dedupeId]] }),
      "--limit",
      "2",
      "--format",
      "json",
    ];

    const scanArgs = [
      "base",
      "+record-list",
      "--as",
      "user",
      "--base-token",
      this.options.baseToken,
      "--table-id",
      this.options.tableId,
      "--field-id",
      "去重 ID",
      "--limit",
      "200",
      "--format",
      "json",
    ];

    const attempts = options.retry ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(700 * attempt);

      const searchedPayload = await this.queryRecordList(searchArgs);
      const searchedId = findRecordIdMatchingDedupeId(searchedPayload, dedupeId);
      if (searchedId) return searchedId;

      const filteredPayload = await this.queryRecordList(args);
      const filteredId = findRecordIdMatchingDedupeId(filteredPayload, dedupeId) ?? findFirstRecordId(filteredPayload);
      if (filteredId) return filteredId;

      const scannedPayload = await this.queryRecordList(scanArgs);
      const scannedId = findRecordIdMatchingDedupeId(scannedPayload, dedupeId);
      if (scannedId) return scannedId;
    }

    return undefined;
  }

  private async findRecordIdByKnownRecordId(recordId: string, dedupeId: string | undefined): Promise<string | undefined> {
    const args = [
      "base",
      "+record-get",
      "--as",
      "user",
      "--base-token",
      this.options.baseToken,
      "--table-id",
      this.options.tableId,
      "--record-id",
      recordId,
      "--field-id",
      "去重 ID",
      "--format",
      "json",
    ];
    const payload = await this.queryRecordList(args);
    if (payloadHasRecordNotFound(payload, recordId)) return undefined;
    if (!dedupeId) return findFirstRecordId(payload) === recordId ? recordId : undefined;
    return findRecordIdMatchingDedupeId(payload, dedupeId) === recordId ? recordId : undefined;
  }

  async writeFields(fields: Record<string, unknown>, options: FeishuWriteOptions = {}): Promise<FeishuWriteResult> {
    const dedupeId = typeof fields["去重 ID"] === "string" ? fields["去重 ID"] : options.lookupDedupeId;
    let existingRecordId: string | undefined;
    let recordId = options.recordId;
    if (recordId && options.lookupDedupeId) {
      recordId = await this.findRecordIdByKnownRecordId(recordId, dedupeId);
      if (!recordId && dedupeId) {
        existingRecordId = await this.findRecordIdByDedupeId(dedupeId);
      }
    } else if (!recordId && dedupeId) {
      existingRecordId = await this.findRecordIdByDedupeId(dedupeId);
    }
    recordId = recordId ?? existingRecordId;
    if (!recordId && options.createIfMissing === false) {
      throw new Error("feishu_record_not_found");
    }
    const writeFields = existingRecordId && options.updateFieldsIfExisting ? options.updateFieldsIfExisting : fields;
    const args = [
      "base",
      "+record-upsert",
      "--as",
      "user",
      "--base-token",
      this.options.baseToken,
      "--table-id",
      this.options.tableId,
      "--json",
      JSON.stringify(writeFields),
    ];
    if (recordId) {
      args.push("--record-id", recordId);
    }

    const stdout = await this.execLarkCli(args, "feishu_write_failed");
    const writtenRecordId = recordId ?? parseWrittenRecordId(stdout);
    if (writtenRecordId || !dedupeId) {
      return existingRecordId ? { recordId: writtenRecordId, matchedExisting: true } : { recordId: writtenRecordId };
    }

    return { recordId: await this.findRecordIdByDedupeId(dedupeId, { retry: true }) };
  }
}

function parseWrittenRecordId(stdout: string | Buffer): string | undefined {
  const text = String(stdout || "{}");
  try {
    return findFirstRecordId(JSON.parse(text) as unknown);
  } catch {
    return text.match(/\brec[a-zA-Z0-9_]+\b/)?.[0];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findFirstRecordId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const object = payload as Record<string, unknown>;
  const directId = readDirectRecordId(object);
  if (directId) return directId;

  for (const key of ["record", "item", "items", "records", "data"]) {
    const value = object[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        const id = findFirstRecordId(item);
        if (id) return id;
      }
    } else {
      const id = findFirstRecordId(value);
      if (id) return id;
    }
  }
  return undefined;
}

function findRecordIdMatchingDedupeId(payload: unknown, dedupeId: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const id = findRecordIdMatchingDedupeId(item, dedupeId);
      if (id) return id;
    }
    return undefined;
  }

  const object = payload as Record<string, unknown>;
  const columnarId = findRecordIdInColumnarPayload(object, dedupeId);
  if (columnarId) return columnarId;

  const recordId = readDirectRecordId(object);
  const fields = object.fields && typeof object.fields === "object" ? (object.fields as Record<string, unknown>) : undefined;
  const dedupeValue = normalizeFeishuCellValue(fields?.["去重 ID"] ?? object["去重 ID"]);
  if (recordId && dedupeValue === dedupeId) return recordId;

  for (const value of Object.values(object)) {
    const id = findRecordIdMatchingDedupeId(value, dedupeId);
    if (id) return id;
  }
  return undefined;
}

function findRecordIdInColumnarPayload(object: Record<string, unknown>, dedupeId: string): string | undefined {
  const recordIds = object.record_id_list;
  const fieldNames = object.fields;
  const rows = object.data;
  if (!Array.isArray(recordIds) || !Array.isArray(fieldNames) || !Array.isArray(rows)) return undefined;

  const dedupeIndex = fieldNames.findIndex((field) => field === "去重 ID");
  if (dedupeIndex === -1) return undefined;

  for (const [index, row] of rows.entries()) {
    if (!Array.isArray(row)) continue;
    const recordId = recordIds[index];
    if (typeof recordId === "string" && recordId.startsWith("rec") && normalizeFeishuCellValue(row[dedupeIndex]) === dedupeId) {
      return recordId;
    }
  }
  return undefined;
}

function payloadHasRecordNotFound(payload: unknown, recordId: string): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (Array.isArray(payload)) return payload.some((item) => payloadHasRecordNotFound(item, recordId));

  const object = payload as Record<string, unknown>;
  const notFound = object.record_not_found;
  if (Array.isArray(notFound) && notFound.some((value) => value === recordId)) return true;

  return Object.values(object).some((value) => payloadHasRecordNotFound(value, recordId));
}

function readDirectRecordId(object: Record<string, unknown>): string | undefined {
  const directId = object.record_id ?? object.recordId ?? object.id;
  return typeof directId === "string" && directId.startsWith("rec") ? directId : undefined;
}

function normalizeFeishuCellValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const joined = value.map(normalizeFeishuCellValue).filter(Boolean).join("");
    return joined || undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const object = value as Record<string, unknown>;
  for (const key of ["text", "value", "name"]) {
    if (typeof object[key] === "string") return object[key];
  }
  return undefined;
}
