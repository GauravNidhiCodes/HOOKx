/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  EXCEPTION_ID,
  createMockApi,
  retryException,
  sampleAudit,
  sampleInvestigation,
  sampleRetry,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("exception detail", () => {
  it("renders exception, payment, event, and reason", async () => {
    const api = createMockApi({
      getInvestigation: vi.fn(async () => sampleInvestigation),
    });
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    expect(await screen.findByRole("heading", { name: "EXCEPTION" })).toBeTruthy();
    expect(await screen.findAllByText("payment.created")).toBeTruthy();
    expect(screen.getByText("PAYMENT")).toBeTruthy();
    expect(screen.getAllByText("CAPTURED").length).toBeGreaterThan(0);
    expect(screen.getByText("EVENT")).toBeTruthy();
    expect(screen.getByText("REASON")).toBeTruthy();
    expect(
      screen.getByText("Assigned by the deterministic exception engine."),
    ).toBeTruthy();
  });

  it("renders the chronological event timeline with state evidence", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    expect(await screen.findByText("REPLAY")).toBeTruthy();
    expect(screen.getAllByText("DELAYED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AUTHORIZED").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CAPTURED").length).toBeGreaterThan(0);
  });

  it("renders retry information for processing failures", async () => {
    const api = createMockApi({
      getException: vi.fn(async () => retryException),
      getRetry: vi.fn(async () => sampleRetry),
    });
    render(
      <App api={api} initialHref={`/exceptions/${retryException.exceptionId}`} />,
    );
    expect(await screen.findByText("TEMPORARY_PROCESSING_FAILURE")).toBeTruthy();
    expect(screen.getByText("RETRY")).toBeTruthy();
    expect(screen.getByText("Maximum attempts")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("PENDING")).toBeTruthy();
    expect(screen.getByText("14:03:18")).toBeTruthy();
  });

  it("renders append-only audit history", async () => {
    const api = createMockApi({
      listPaymentAudit: vi.fn(async () => sampleAudit),
    });
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    expect(await screen.findByText("AUDIT HISTORY")).toBeTruthy();
    expect(screen.getByText("corr-ui-replay")).toBeTruthy();
    expect(screen.getAllByText("SYSTEM").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("displays an advisory investigation", async () => {
    const api = createMockApi({
      getInvestigation: vi.fn(async () => sampleInvestigation),
    });
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    expect(
      await screen.findByText("Deterministic conflict classification with no financial mutation."),
    ).toBeTruthy();
    expect(
      screen.getAllByText("ADVISORY — DETERMINISTIC SYSTEM REMAINS AUTHORITATIVE").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("INVESTIGATE_CONFLICTING_PAYLOAD").length).toBeGreaterThan(0);
    expect(screen.getByText("MEDIUM")).toBeTruthy();
    expect(screen.getByText("NOT EXECUTABLE")).toBeTruthy();
    expect(
      screen.getByText(/simulator data/i),
    ).toBeTruthy();
  });

  it("shows investigation loading then the result", async () => {
    let finish: ((value: typeof sampleInvestigation) => void) | undefined;
    const pending = new Promise<typeof sampleInvestigation>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      investigate: vi.fn(async () => pending),
    });
    const user = userEvent.setup();
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    const button = await screen.findByRole("button", { name: "Investigate" });
    await user.click(button);
    expect(await screen.findByText("LOADING INVESTIGATION…")).toBeTruthy();
    finish?.(sampleInvestigation);
    expect(
      await screen.findByText("Deterministic conflict classification with no financial mutation."),
    ).toBeTruthy();
  });

  it("shows investigation failure with a correlation id", async () => {
    const api = createMockApi({
      investigate: vi.fn(async () => {
        throw new ApiError(
          "MALFORMED_MODEL_OUTPUT",
          "corr-failed",
          400,
          "INVESTIGATION REQUEST FAILED",
        );
      }),
    });
    const user = userEvent.setup();
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    await user.click(await screen.findByRole("button", { name: "Investigate" }));
    expect(await screen.findByText("INVESTIGATION REQUEST FAILED")).toBeTruthy();
    expect(screen.getByText("corr-failed")).toBeTruthy();
    expect(screen.getByText("MALFORMED_MODEL_OUTPUT")).toBeTruthy();
  });

  it("focuses Investigate with the keyboard", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/exceptions/${EXCEPTION_ID}`} />);
    const button = (await screen.findByRole("button", { name: "Investigate" })) as HTMLButtonElement;
    button.focus();
    expect(document.activeElement).toBe(button);
    await waitFor(() => {
      expect(button.disabled).toBe(false);
    });
  });
});
