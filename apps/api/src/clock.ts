import { instant, type Instant } from "@hookx/domain";

export type Clock = {
  now(): Instant;
};

/** HTTP composition clock. The verifier never calls this internally. */
export function systemClock(): Clock {
  return {
    now(): Instant {
      return instant(new Date().toISOString());
    },
  };
}

export function fixedClock(value: Instant): Clock {
  return {
    now(): Instant {
      return value;
    },
  };
}
