export type ContentType = "video" | "image_text" | "text" | "link" | "unknown";

export type ProcessingStatus =
  | "recorded"
  | "pending_summary"
  | "summarized"
  | "pending_deep_processing"
  | "transcribed"
  | "needs_manual_review"
  | "pending_retry"
  | "ignored"
  | "knowledge_note_created";

export interface MessageSnapshot {
  snapshotId: string;
  title?: string;
  text: string;
  html: string;
  links: string[];
  images: string[];
  timestamp?: string;
}

export interface CapturedItem {
  type: ContentType;
  title: string;
  url?: string;
  text: string;
  author?: string;
  timestamp?: string;
  rawSnapshot: string;
}

export interface SummaryResult {
  summary: string;
  suggestedCategory: string;
}

export interface CaptureRecord extends CapturedItem {
  dedupeId: string;
  feishuRecordId?: string;
  status: ProcessingStatus;
  capturedAt: string;
  summary?: SummaryResult;
  errorMessage?: string;
  knowledgeBaseUrl?: string;
}
