export interface GoogleDriveIntegrationConfig {
  rootFolderId?: string;
  recursive?: boolean;
  maxFilesPerRun?: number;
  stateKeyPrefix?: string;
  dedupeTtlSeconds?: number;
  importSource?: string;
  uploadTargetFolderId?: string;
}

export interface HandlerResult {
  success: boolean;
  message?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface DrivePdfFile {
  id: string;
  name: string;
  mimeType?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
  parentIds?: string[];
}

export interface DriveDirectory {
  id: string;
  name: string;
  parentIds?: string[];
}

export interface CrawlResult extends HandlerResult {
  scannedFiles: number;
  imported: number;
  duplicates: number;
  skipped: number;
  failed: number;
}

export interface ListDirectoriesInput {
  folderId?: string;
  recursive?: boolean;
  limit?: number;
}

export interface ListDirectoriesResult extends HandlerResult {
  folderId: string;
  count: number;
  directories: DriveDirectory[];
}

export interface UploadDocumentInput {
  documentId: string;
  targetFolderId?: string;
  fileName?: string;
}

export interface UploadDocumentResult extends HandlerResult {
  documentId: string;
  driveFileId?: string;
  webViewLink?: string;
}
