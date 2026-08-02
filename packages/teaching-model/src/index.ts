export type TeachingBlockType =
  | "explanation"
  | "runnable"
  | "comparison"
  | "css-controller"
  | "annotation"
  | "group";

export type AuthorType = "user" | "ai" | "system";

export interface StoredFile {
  readonly path: string;
  readonly mimeType: string;
  readonly content: string;
  readonly encoding?: "utf8" | "base64";
}

export interface CodeRevision {
  readonly id: string;
  readonly blockId: string;
  readonly parentRevisionId: string | null;
  readonly authorType: AuthorType;
  readonly files: Readonly<Record<string, StoredFile>>;
  readonly contentHash: string;
  readonly changeSummary: string;
  readonly createdAt: string;
  readonly mutationId?: string;
  readonly mutationDigest?: string;
}

export interface ImportSnapshot {
  readonly id: string;
  readonly canvasId: string;
  readonly runtimeType: string;
  readonly entryFile: string;
  readonly files: Readonly<Record<string, StoredFile>>;
  readonly contentHash: string;
  readonly createdAt: string;
}
