export const STORAGE_ERROR_CODE = {
  MISSING_DATABASE_URL: "MISSING_DATABASE_URL",
  UNSAFE_DATABASE_NAME: "UNSAFE_DATABASE_NAME",
  EVENT_NOT_FOUND: "EVENT_NOT_FOUND",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  INCONSISTENT_IDENTITY: "INCONSISTENT_IDENTITY",
  INVALID_ROW: "INVALID_ROW",
} as const;

export type StorageErrorCode =
  (typeof STORAGE_ERROR_CODE)[keyof typeof STORAGE_ERROR_CODE];

export class StorageError extends Error {
  public readonly code: StorageErrorCode;

  public constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}
