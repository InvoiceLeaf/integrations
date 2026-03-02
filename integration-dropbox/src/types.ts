export interface DropboxIntegrationConfig {
  rootPath?: string;
  recursive?: boolean;
  maxFilesPerRun?: number;
  stateKeyPrefix?: string;
  dedupeTtlSeconds?: number;
  importSource?: string;
  uploadTargetPath?: string;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface DropboxPdfFile {
  id: string;
  name: string;
  pathDisplay: string;
  pathLower: string;
  rev?: string;
  contentHash?: string;
  clientModified?: string;
  serverModified?: string;
}

export interface DropboxDirectory {
  id: string;
  name: string;
  pathDisplay: string;
  pathLower: string;
}

export interface CrawlResult extends HandlerResult {
  scannedFiles: number;
  imported: number;
  duplicates: number;
  skipped: number;
  failed: number;
}

export interface ListDirectoriesInput {
  path?: string;
  recursive?: boolean;
  limit?: number;
}

export interface ListDirectoriesResult extends HandlerResult {
  path: string;
  count: number;
  directories: DropboxDirectory[];
}

export interface UploadDocumentInput {
  documentId: string;
  targetPath?: string;
  fileName?: string;
  overwrite?: boolean;
}

export interface UploadDocumentResult extends HandlerResult {
  documentId: string;
  dropboxFileId?: string;
  pathDisplay?: string;
}
