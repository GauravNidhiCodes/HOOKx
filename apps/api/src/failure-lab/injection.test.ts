import { describe, expect, it } from "vitest";
import { paymentId, providerId } from "@hookx/domain";
import {
  RetryableProcessingError,
  processPaymentEvents,
} from "@hookx/storage";
import { createLabProcessFn } from "./injection.js";

const emptyRepo = { listByPayment: async () => [] } as never;

describe("Failure Lab injection isolation", () => {
  it("does not inject ALWAYS_FAIL for a non-synthetic payment", async () => {
    const fn = createLabProcessFn("ALWAYS_FAIL");
    const result = await fn(
      emptyRepo,
      providerId("razorpay"),
      paymentId("pay_live_not_lab"),
    );
    expect(result.decisions).toEqual([]);
  });

  it("does not inject FAIL_ONCE for simulator ids outside the lab prefix", async () => {
    const fn = createLabProcessFn("FAIL_ONCE");
    const result = await fn(
      emptyRepo,
      providerId("SYNTHETIC"),
      paymentId("SYNTHETIC:pay:sim-retry"),
    );
    expect(result.decisions).toEqual([]);
  });

  it("injects FAIL_ONCE only once for a lab payment", async () => {
    const fn = createLabProcessFn("FAIL_ONCE");
    const lab = paymentId("SYNTHETIC:pay:lab-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await expect(
      fn(emptyRepo, providerId("SYNTHETIC"), lab),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
    const second = await fn(emptyRepo, providerId("SYNTHETIC"), lab);
    expect(second.decisions).toEqual([]);
  });

  it("injects ALWAYS_FAIL on every lab attempt", async () => {
    const fn = createLabProcessFn("ALWAYS_FAIL");
    const lab = paymentId("SYNTHETIC:pay:lab-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await expect(
      fn(emptyRepo, providerId("SYNTHETIC"), lab),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
    await expect(
      fn(emptyRepo, providerId("SYNTHETIC"), lab),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
  });

  it("injects FAIL_ONCE for a Razorpay-provider lab payment", async () => {
    const fn = createLabProcessFn("FAIL_ONCE");
    const lab = paymentId("SYNTHETIC:pay:lab-dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await expect(
      fn(emptyRepo, providerId("razorpay"), lab),
    ).rejects.toBeInstanceOf(RetryableProcessingError);
    const second = await fn(emptyRepo, providerId("razorpay"), lab);
    expect(second.decisions).toEqual([]);
  });

  it("does not inject FAIL_ONCE for a live-shaped Razorpay payment id", async () => {
    const fn = createLabProcessFn("FAIL_ONCE");
    const result = await fn(
      emptyRepo,
      providerId("razorpay"),
      paymentId("pay_live_not_lab"),
    );
    expect(result.decisions).toEqual([]);
  });

  it("NONE delegates to processPaymentEvents", async () => {
    const fn = createLabProcessFn("NONE");
    expect(fn).not.toBe(processPaymentEvents);
    const result = await fn(
      emptyRepo,
      providerId("SYNTHETIC"),
      paymentId("SYNTHETIC:pay:lab-cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    );
    expect(result.decisions).toEqual([]);
  });
});
