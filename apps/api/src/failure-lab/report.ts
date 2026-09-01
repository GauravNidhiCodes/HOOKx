export type FailureLabDeliveryResult = {
  readonly stepIndex: number;
  readonly eventType: string;
  readonly eventKey: string;
  readonly httpStatus: number;
  readonly bodyStatus: string;
  readonly code: string | null;
  readonly kind: string;
};

export type FailureLabLogEntry = {
  readonly clock: string;
  readonly lifecycle: string;
  readonly decision: string | null;
  readonly inferred: boolean;
};

export type FailureLabRetrySnapshot = {
  readonly attemptCount: number;
  readonly status: string;
  readonly nextAttemptAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastFailedAt: string | null;
  readonly failureClass: string | null;
};

export type FailureLabDeadLetterSnapshot = {
  readonly failureCode: string;
  readonly attemptCount: number;
  readonly deadLetteredAt: string;
};

export type FailureLabReplaySnapshot = {
  readonly beforeState: string | null;
  readonly afterState: string | null;
  readonly delayed: boolean;
};

export type FailureLabRunReport = {
  readonly runId: string;
  readonly scenario: string;
  readonly title: string;
  readonly synthetic: true;
  readonly demoRun: boolean;
  readonly labels: readonly string[];
  readonly notice: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly failureMode: string;
  readonly retryPolicy: {
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
  };
  readonly input: {
    readonly deliveries: number;
    readonly eventOrderSent: readonly string[];
    readonly eventTimeOrder: readonly string[];
  };
  readonly result: {
    readonly processed: number;
    readonly duplicate: number;
    readonly conflict: number;
    readonly error: number;
    readonly accepted: number;
  };
  readonly stateChange: number;
  readonly payment: {
    readonly paymentId: string;
    readonly state: string | null;
    readonly amountMinor: string | null;
  };
  readonly originalAmountMinor: string | null;
  readonly originalPayloadHash: string | null;
  readonly exception: {
    readonly exceptionId: string;
    readonly exceptionCode: string;
  } | null;
  readonly incidentId: string | null;
  readonly auditCount: number;
  readonly retry: FailureLabRetrySnapshot | null;
  readonly deadLetter: FailureLabDeadLetterSnapshot | null;
  readonly replay: FailureLabReplaySnapshot | null;
  readonly log: readonly FailureLabLogEntry[];
  readonly deliveries: readonly FailureLabDeliveryResult[];
  readonly links: {
    readonly incident: string | null;
    readonly payment: string | null;
    readonly event: string | null;
  };
};
