import { DomainError } from "./domain-error.js";
import { isoCurrencyCode, type IsoCurrencyCode } from "./ids.js";

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: IsoCurrencyCode;
}

export function money(amountMinor: bigint, currency: string): Money {
  if (typeof amountMinor !== "bigint") {
    throw new DomainError(
      "MONEY_AMOUNT_NOT_BIGINT",
      "amountMinor must be a bigint minor-unit value",
    );
  }
  if (amountMinor < 0n) {
    throw new DomainError(
      "MONEY_AMOUNT_NEGATIVE",
      "amountMinor must be greater than or equal to 0",
    );
  }

  return Object.freeze({
    amountMinor,
    currency: isoCurrencyCode(currency),
  });
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.amountMinor === right.amountMinor && left.currency === right.currency;
}

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new DomainError(
      "MONEY_CURRENCY_MISMATCH",
      `cannot add ${left.currency} to ${right.currency}`,
    );
  }
  return money(left.amountMinor + right.amountMinor, left.currency);
}
