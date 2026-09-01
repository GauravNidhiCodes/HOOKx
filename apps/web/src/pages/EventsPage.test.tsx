/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  PAYMENT_ID,
  WEBHOOK_ID,
  createMockApi,
  sampleAudit,
  sampleRetry,
  sampleRetryAudit,
  sampleWebhooks,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("event index", () => {
  it("renders persisted webhook events", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/events" />);
    expect(await screen.findByRole("link", { name: WEBHOOK_ID })).toBeTruthy();
    expect(screen.getAllByText("payment.created").length).toBeGreaterThan(0);
    expect(screen.getAllByText("PROCESSED").length).toBeGreaterThan(0);
    expect(api.listWebhooks).toHaveBeenCalled();
  });

  it("filters through the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/events" />);
    await screen.findByRole("link", { name: WEBHOOK_ID });
    await user.selectOptions(screen.getByLabelText("Event type"), "payment.created");
    await user.selectOptions(screen.getByLabelText("Processing status"), "PROCESSED");
    await user.type(screen.getByLabelText("Search IDs"), "ui-created");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(api.listWebhooks).toHaveBeenLastCalledWith({
        eventType: "payment.created",
        processingStatus: "PROCESSED",
        q: "ui-created",
      });
    });
  });

  it("shows a loading state", async () => {
    let finish: ((value: typeof sampleWebhooks) => void) | undefined;
    const pending = new Promise<typeof sampleWebhooks>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      listWebhooks: vi.fn(async () => pending),
    });
    render(<App api={api} initialHref="/events" />);
    expect(await screen.findByText("LOADING EVENTS…")).toBeTruthy();
    finish?.(sampleWebhooks);
    expect(await screen.findByRole("link", { name: WEBHOOK_ID })).toBeTruthy();
  });
});

describe("event inspector", () => {
  it("renders event fields, processing, and sanitized payload notice", async () => {
    const api = createMockApi({
      listWebhookAudit: vi.fn(async () => [
        {
          ...sampleAudit[0]!,
          eventType: "WEBHOOK_RECEIVED",
          webhookEventId: WEBHOOK_ID,
        },
      ]),
    });
    render(<App api={api} initialHref={`/events/${WEBHOOK_ID}`} />);
    expect(await screen.findByRole("heading", { name: "EVENT" })).toBeTruthy();
    expect(screen.getByText("PROCESSING")).toBeTruthy();
    expect(screen.getByText("PASSED")).toBeTruthy();
    expect(screen.getByText("NORMALIZED")).toBeTruthy();
    expect(screen.getByText("STORED")).toBeTruthy();
    expect(screen.getByText("SANITIZED PAYLOAD")).toBeTruthy();
    expect(
      screen.getByText(/Raw webhook payloads are not stored/),
    ).toBeTruthy();
    expect(screen.queryByText("payloadHash")).toBeNull();
    expect(
      screen.getByRole("link", { name: PAYMENT_ID }).getAttribute("href"),
    ).toBe(`/payments/${encodeURIComponent(PAYMENT_ID)}`);
  });

  it("renders retry history on the event", async () => {
    const api = createMockApi({
      listWebhookAudit: vi.fn(async () => sampleRetryAudit),
      getRetry: vi.fn(async () => sampleRetry),
    });
    render(<App api={api} initialHref={`/events/${WEBHOOK_ID}`} />);
    expect(await screen.findByText("ATTEMPT 1")).toBeTruthy();
    expect(screen.getByText("SUCCESS")).toBeTruthy();
  });

  it("shows not found", async () => {
    const api = createMockApi({
      getWebhook: vi.fn(async () => null),
    });
    render(<App api={api} initialHref="/events/missing-event" />);
    expect(await screen.findByText("NOT FOUND")).toBeTruthy();
    expect(screen.getByText("EVENT NOT FOUND")).toBeTruthy();
  });

  it("shows unable to load with a correlation id", async () => {
    const api = createMockApi({
      getWebhook: vi.fn(async () => {
        throw new ApiError("REQUEST_FAILED", "corr-evt", 500, "UNABLE TO LOAD EVENT");
      }),
    });
    render(<App api={api} initialHref={`/events/${WEBHOOK_ID}`} />);
    expect(await screen.findByText("UNABLE TO LOAD EVENT")).toBeTruthy();
    expect(screen.getByText("corr-evt")).toBeTruthy();
  });

  it("shows a loading state", async () => {
    let finish: ((value: (typeof sampleWebhooks)[0]) => void) | undefined;
    const pending = new Promise<(typeof sampleWebhooks)[0]>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      getWebhook: vi.fn(async () => pending),
    });
    render(<App api={api} initialHref={`/events/${WEBHOOK_ID}`} />);
    expect(await screen.findByText("LOADING EVENT…")).toBeTruthy();
    finish?.(sampleWebhooks[0]!);
    expect(await screen.findByRole("heading", { name: "EVENT" })).toBeTruthy();
  });

  it("exposes copy and payment links to the keyboard", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/events/${WEBHOOK_ID}`} />);
    const copy = await screen.findByRole("button", { name: "Copy event ID" });
    copy.focus();
    expect(document.activeElement).toBe(copy);
    const payment = screen.getByRole("link", { name: PAYMENT_ID });
    payment.focus();
    expect(document.activeElement).toBe(payment);
  });
});
