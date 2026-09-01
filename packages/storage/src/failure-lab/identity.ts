export const FAILURE_LAB_PROVIDER = "SYNTHETIC";
export const FAILURE_LAB_PAYMENT_PREFIX = "SYNTHETIC:pay:lab-";
export const FAILURE_LAB_EVENT_PREFIX = "SYNTHETIC:evt:lab-";
export const FAILURE_LAB_PAYMENT_LIKE = "SYNTHETIC:pay:lab-%";

export function isFailureLabPaymentId(value: string | null | undefined): boolean {
  return (
    typeof value === "string" && value.startsWith(FAILURE_LAB_PAYMENT_PREFIX)
  );
}

export function isFailureLabEventId(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(FAILURE_LAB_EVENT_PREFIX);
}
