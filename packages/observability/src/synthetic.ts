export function isSyntheticRef(value: string | null | undefined): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  return value === "SYNTHETIC" || value.startsWith("SYNTHETIC:");
}

/**
 * HOOKX never labels traffic as live unless the operator has
 * opted a provider into HOOKX_LIVE_PROVIDERS. Simulator data, Razorpay
 * fixtures, and undeclared origins are SYNTHETIC.
 */
export function isSyntheticOrigin(
  provider: string | null | undefined,
  paymentId: string | null | undefined,
  liveProviders: readonly string[] = [],
): boolean {
  if (isSyntheticRef(provider) || isSyntheticRef(paymentId)) {
    return true;
  }
  if (
    provider !== null &&
    provider !== undefined &&
    liveProviders.includes(provider)
  ) {
    return false;
  }
  return true;
}
