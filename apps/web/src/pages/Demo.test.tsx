/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  EXCEPTION_ID,
  createMockApi,
  sampleGoldenDemoExhausted,
  sampleInvestigation,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("golden demo", () => {
  it("renders the synthetic demonstration header without completing steps", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/demo" />);
    expect(await screen.findByRole("heading", { name: "HOOKX" })).toBeTruthy();
    expect(
      screen.getByText("PAYMENT WEBHOOK RELIABILITY ENGINE"),
    ).toBeTruthy();
    expect(screen.getByText("SYNTHETIC DEMONSTRATION")).toBeTruthy();
    expect(screen.getByText("NOT LIVE PAYMENT PROCESSING")).toBeTruthy();
    expect(
      screen.getByText(
        "Observe how HOOKX handles a webhook failure without allowing the financial state to become inconsistent.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("01 RECEIVE")).toBeTruthy();
    expect(screen.getByText("08 INVESTIGATE")).toBeTruthy();
    expect(screen.queryAllByText("DONE").length).toBe(0);
    expect(screen.getByRole("button", { name: "RUN DEMO" })).toBeTruthy();
    expect(screen.queryByText("CONNECTED")).toBeNull();
    expect(screen.queryByText(/uptime/i)).toBeNull();
    expect(api.runGoldenDemo).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(api.listGoldenDemoRuns).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });
    expect(api.listGoldenDemoRuns).toHaveBeenCalledTimes(1);
  });

  it("runs the backend demo and marks steps from the report", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/demo" />);
    await screen.findByRole("button", { name: "RUN DEMO" });
    await user.click(screen.getByRole("button", { name: "RUN DEMO" }));
    await waitFor(() => {
      expect(api.runGoldenDemo).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("DEMO RUN COMPLETE")).toBeTruthy();
    expect(screen.getByText("PROCESSING FAILED")).toBeTruthy();
    expect(screen.getByText("TEMPORARY_PROCESSING_FAILURE")).toBeTruthy();
    expect(screen.getByText("RETRYABLE")).toBeTruthy();
    expect(screen.getByText(/ATTEMPT 1 FAILED/)).toBeTruthy();
    expect(screen.getByText(/ATTEMPT 2 RECOVERED/)).toBeTruthy();
    expect(screen.getByText("WEBHOOK RECOVERED")).toBeTruthy();
    expect(screen.getByText("NO DUPLICATE ECONOMIC EFFECT")).toBeTruthy();
    expect(screen.getByText("AUDIT TRAIL AVAILABLE")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "VIEW INCIDENT" }).getAttribute("href"),
    ).toBe(`/incidents/${EXCEPTION_ID}`);
    expect(
      screen.getByRole("link", { name: "VIEW TIMELINE" }).getAttribute("href"),
    ).toBe(`/incidents/${EXCEPTION_ID}#timeline`);
    expect(screen.getByText("EVENT payment.authorized PROCESSED")).toBeTruthy();
    expect(screen.getByText("PAYMENT none")).toBeTruthy();
    expect(screen.getByText(/does not invent payment.created/)).toBeTruthy();
    expect(screen.getAllByText("DONE").length).toBe(7);
    expect(screen.queryByText("signature")).toBeNull();
    expect(screen.queryByText(/x-razorpay/i)).toBeNull();
  });

  it("requests investigation from the existing incident API", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      investigateIncident: vi.fn(async () => sampleInvestigation),
    });
    render(<App api={api} initialHref="/demo" />);
    await user.click(await screen.findByRole("button", { name: "RUN DEMO" }));
    await screen.findByText("DEMO RUN COMPLETE");
    await user.click(screen.getByRole("button", { name: "INVESTIGATE" }));
    await waitFor(() => {
      expect(api.investigateIncident).toHaveBeenCalledWith(EXCEPTION_ID);
    });
    expect(await screen.findAllByText("AI-GENERATED INVESTIGATION")).toBeTruthy();
    expect(screen.getAllByText(/READ-ONLY/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NO FINANCIAL STATE CHANGES/).length).toBeGreaterThan(0);
    expect(screen.getByText(sampleInvestigation.result.summary)).toBeTruthy();
    expect(screen.getAllByText("DONE").length).toBe(8);
  });

  it("starts a new isolated run without implying deletion", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/demo" />);
    await user.click(await screen.findByRole("button", { name: "RUN DEMO" }));
    await screen.findByText("DEMO RUN COMPLETE");
    await user.click(screen.getByRole("button", { name: "NEW DEMO RUN" }));
    await waitFor(() => {
      expect(api.runGoldenDemo).toHaveBeenCalledTimes(2);
    });
  });

  it("shows DEMO FAILED when the backend rejects the run", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      runGoldenDemo: vi.fn(async () => {
        throw new ApiError(
          "RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE",
          "corr-demo-fail",
          503,
          "DEMO FAILED",
        );
      }),
    });
    render(<App api={api} initialHref="/demo" />);
    await user.click(await screen.findByRole("button", { name: "RUN DEMO" }));
    expect(await screen.findByText("DEMO FAILED")).toBeTruthy();
    expect(screen.getByText("RAZORPAY_WEBHOOK_SECRET_UNAVAILABLE")).toBeTruthy();
    expect(screen.getByText("corr-demo-fail")).toBeTruthy();
    expect(screen.queryByText("DEMO RUN COMPLETE")).toBeNull();
    expect(screen.queryAllByText("DONE").length).toBe(0);
  });

  it("reports RETRY EXHAUSTED instead of recovery", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      runGoldenDemo: vi.fn(async () => sampleGoldenDemoExhausted),
    });
    render(<App api={api} initialHref="/demo" />);
    await user.click(await screen.findByRole("button", { name: "RUN DEMO" }));
    expect(await screen.findAllByText(/RETRY EXHAUSTED/)).toBeTruthy();
    expect(screen.queryByText(/ATTEMPT 2 RECOVERED/)).toBeNull();
    expect(screen.queryByText("WEBHOOK RECOVERED")).toBeNull();
    expect(screen.getByText(/Processing did not recover/)).toBeTruthy();
  });
});
