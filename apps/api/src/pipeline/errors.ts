export const PIPELINE_ERROR_CODE = {
  UNSUPPORTED_PROVIDER: "UNSUPPORTED_PROVIDER",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  MISSING_SIGNATURE: "MISSING_SIGNATURE",
  MALFORMED_SIGNATURE: "MALFORMED_SIGNATURE",
  EXPIRED_SIGNATURE: "EXPIRED_SIGNATURE",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  CONFLICT: "CONFLICT",
  TEMPORARY_PROCESSING_FAILURE: "TEMPORARY_PROCESSING_FAILURE",
} as const;

export type PipelineErrorCode =
  (typeof PIPELINE_ERROR_CODE)[keyof typeof PIPELINE_ERROR_CODE];

export type PipelineHttpBody = {
  readonly status: string;
  readonly requestId: string;
  readonly code?: string;
};

export function pipelineHttpBody(
  status: string,
  requestId: string,
  code?: string,
): PipelineHttpBody {
  if (code === undefined) {
    return Object.freeze({ status, requestId });
  }
  return Object.freeze({ status, requestId, code });
}
