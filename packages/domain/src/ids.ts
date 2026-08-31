import { DomainError } from "./domain-error.js";

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type PaymentId = Brand<string, "PaymentId">;
export type ProviderId = Brand<string, "ProviderId">;
export type ExternalEventId = Brand<string, "ExternalEventId">;
export type PayloadHash = Brand<string, "PayloadHash">;
export type IsoCurrencyCode = Brand<string, "IsoCurrencyCode">;
export type Instant = Brand<string, "Instant">;

const PRINTABLE_ID = /^[A-Za-z0-9._:~-]+$/;
const ISO_CURRENCY = /^[A-Z]{3}$/;
const INSTANT_UTC =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$/;

function assertIdentity(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_IDENTITY", `${label} must be a string`);
  }
  if (value.length === 0) {
    throw new DomainError("INVALID_IDENTITY", `${label} must be non-empty`);
  }
  if (value !== value.trim()) {
    throw new DomainError(
      "INVALID_IDENTITY",
      `${label} must not include leading or trailing whitespace`,
    );
  }
  if (!PRINTABLE_ID.test(value)) {
    throw new DomainError(
      "INVALID_IDENTITY",
      `${label} may contain only A-Z, a-z, 0-9, and . _ : ~ -`,
    );
  }
  return value;
}

export function paymentId(value: string): PaymentId {
  return assertIdentity(value, "paymentId") as PaymentId;
}

export function providerId(value: string): ProviderId {
  return assertIdentity(value, "providerId") as ProviderId;
}

export function externalEventId(value: string): ExternalEventId {
  return assertIdentity(value, "externalEventId") as ExternalEventId;
}

export function payloadHash(value: string): PayloadHash {
  return assertIdentity(value, "payloadHash") as PayloadHash;
}

export function isoCurrencyCode(value: string): IsoCurrencyCode {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_CURRENCY", "currency must be a string");
  }
  if (!ISO_CURRENCY.test(value)) {
    throw new DomainError(
      "INVALID_CURRENCY",
      "currency must be a 3-letter ISO 4217 alphabetic code (uppercase)",
    );
  }
  return value as IsoCurrencyCode;
}

export function instant(value: string): Instant {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INSTANT", "instant must be a string");
  }
  if (!INSTANT_UTC.test(value)) {
    throw new DomainError(
      "INVALID_INSTANT",
      "instant must be an ISO-8601 UTC timestamp ending in Z",
    );
  }
  return value as Instant;
}
