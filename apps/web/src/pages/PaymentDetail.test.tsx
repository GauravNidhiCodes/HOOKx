/** @vitest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  CAPTURE_WEBHOOK_ID,
  EXCEPTION_ID,
  PAYMENT_ID,
  WEBHOOK_ID,
  createMockApi,
  outOfOrderWebhooks,
  sampleInvestigation,
  samplePayment,
  sampleRetry,
  sampleRetryAudit,
  sampleWebhooks,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("payment workspace", () => {
  it("renders payment identity, money as minor units, and synthetic classification", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByRole("heading", { name: "PAYMENT" })).toBeTruthy();
    expect(screen.getAllByText(PAYMENT_ID).length).toBeGreaterThan(0);
    expect(screen.getByText("10000")).toBeTruthy();
    expect(screen.getByText("INR")).toBeTruthy();
    expect(screen.getAllByText("SYNTHETIC").length).toBeGreaterThan(0);
    expect(screen.queryByText(/LIVE/)).toBeNull();
    expect(screen.queryByText(/PRODUCTION/)).toBeNull();
  });

  it("renders backend-derived state history", async () => {
    const api = createMockApi({
      listPaymentWebhooks: vi.fn(async () => outOfOrderWebhooks),
    });
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByRole("heading", { name: "STATE HISTORY" })).toBeTruthy();
    expect(screen.getByText("CREATED")).toBeTruthy();
    expect(screen.getAllByText("AUTHORIZED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CAPTURED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("TRANSITION").length).toBeGreaterThan(0);
  });

  it("lists webhook events with occurredAt distinct from receivedAt", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByText("occurredAt")).toBeTruthy();
    expect(screen.getByText("receivedAt")).toBeTruthy();
    expect(screen.getAllByText("14:02:11").length).toBeGreaterThan(0);
    expect(screen.getAllByText("14:02:14").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: WEBHOOK_ID }).length).toBeGreaterThan(0);
  });

  it("visualizes deterministic out-of-order replay", async () => {
    const api = createMockApi({
      listPaymentWebhooks: vi.fn(async () => outOfOrderWebhooks),
    });
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByText("Original delivery order")).toBeTruthy();
    expect(screen.getByText("Resolved logical order")).toBeTruthy();
    expect(
      screen.getByText("DETERMINISTIC REPLAY RESULT — NOT PRODUCED BY AI INVESTIGATION"),
    ).toBeTruthy();
    expect(screen.getAllByText("1. payment.created").length).toBe(2);
    expect(screen.getByText("2. payment.captured")).toBeTruthy();
    expect(screen.getByText("3. payment.authorized")).toBeTruthy();
    expect(screen.getByText("2. payment.authorized")).toBeTruthy();
    expect(screen.getByText("3. payment.captured")).toBeTruthy();
  });

  it("links exceptions into the investigation loop", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    const link = await screen.findByRole("link", { name: "CONFLICTING_EVENT" });
    expect(link.getAttribute("href")).toBe(`/exceptions/${EXCEPTION_ID}`);
  });

  it("renders retry history from audit", async () => {
    const api = createMockApi({
      listPaymentAudit: vi.fn(async () => sampleRetryAudit),
      getRetry: vi.fn(async () => sampleRetry),
    });
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByText("ATTEMPT 1")).toBeTruthy();
    expect(screen.getByText("TEMPORARY FAILURE")).toBeTruthy();
    expect(screen.getByText("SUCCESS")).toBeTruthy();
    expect(screen.queryByText(/stack/i)).toBeNull();
  });

  it("renders immutable audit history", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByText("APPEND-ONLY AUDIT HISTORY — RECORDS ARE NOT EDITED OR DELETED")).toBeTruthy();
    expect(screen.getByText("corr-ui-replay")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("renders an advisory investigation with evidence links", async () => {
    const api = createMockApi({
      getInvestigation: vi.fn(async () => sampleInvestigation),
    });
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(
      await screen.findByText("Deterministic conflict classification with no financial mutation."),
    ).toBeTruthy();
    expect(
      screen.getAllByText("ADVISORY — DETERMINISTIC SYSTEM REMAINS AUTHORITATIVE").length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: EXCEPTION_ID })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: WEBHOOK_ID }).length).toBeGreaterThan(0);
  });

  it("filters events on the payment workspace", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    await screen.findAllByRole("link", { name: WEBHOOK_ID });
    await user.selectOptions(screen.getByLabelText("Event type"), "payment.created");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    const table = screen.getByRole("table", { name: "Webhook events" });
    expect(within(table).getByRole("link", { name: WEBHOOK_ID })).toBeTruthy();
    expect(within(table).queryByRole("link", { name: CAPTURE_WEBHOOK_ID })).toBeNull();
  });

  it("exposes copy actions to the keyboard", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    const button = await screen.findByRole("button", { name: "Copy payment ID" });
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("shows not found without a stack trace", async () => {
    const api = createMockApi({
      getPayment: vi.fn(async () => null),
    });
    render(<App api={api} initialHref="/payments/missing-payment" />);
    expect(await screen.findByText("NOT FOUND")).toBeTruthy();
    expect(screen.getByText("PAYMENT NOT FOUND")).toBeTruthy();
    expect(screen.queryByText(/at /)).toBeNull();
  });

  it("shows unable to load with a correlation id", async () => {
    const api = createMockApi({
      getPayment: vi.fn(async () => {
        throw new ApiError("REQUEST_FAILED", "corr-pay", 500, "UNABLE TO LOAD PAYMENT");
      }),
    });
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByText("UNABLE TO LOAD PAYMENT")).toBeTruthy();
    expect(screen.getByText("corr-pay")).toBeTruthy();
  });

  it("shows loading states", async () => {
    let finishPayment: ((value: typeof samplePayment) => void) | undefined;
    const pendingPayment = new Promise<typeof samplePayment>((resolve) => {
      finishPayment = resolve;
    });
    let finishEvents: ((value: typeof sampleWebhooks) => void) | undefined;
    const pendingEvents = new Promise<typeof sampleWebhooks>((resolve) => {
      finishEvents = resolve;
    });
    const api = createMockApi({
      getPayment: vi.fn(async () => pendingPayment),
      listPaymentWebhooks: vi.fn(async () => pendingEvents),
    });
    render(<App api={api} initialHref={`/payments/${PAYMENT_ID}`} />);
    expect(await screen.findByText("LOADING PAYMENT…")).toBeTruthy();
    finishPayment?.(samplePayment);
    expect((await screen.findAllByText("LOADING EVENTS…")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("LOADING AUDIT HISTORY…").length).toBeGreaterThan(0);
    finishEvents?.(sampleWebhooks);
    expect(await screen.findByRole("heading", { name: "EVENTS" })).toBeTruthy();
  });
});
