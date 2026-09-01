/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  createMockApi,
  sampleMetricsEmpty,
  sampleMetricsPopulated,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("overview", () => {
  it("explains HOOKX and keeps primary navigation to operator sections", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/" />);
    expect(await screen.findByRole("heading", { name: "OVERVIEW" })).toBeTruthy();
    expect(
      screen.getByText(
        "Payment webhook infrastructure that detects, contains, and recovers from delivery failures.",
      ),
    ).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav.textContent).toContain("Overview");
    expect(nav.textContent).toContain("Demo");
    expect(nav.textContent).toContain("Failure Lab");
    expect(nav.textContent).toContain("Incidents");
    expect(nav.textContent).not.toContain("Exceptions");
    expect(nav.textContent).not.toContain("Payments");
    expect(nav.textContent).not.toContain("Events");
    expect(screen.getByRole("heading", { name: "ARCHITECTURE" })).toBeTruthy();
    expect(screen.getByLabelText("System architecture").textContent).toContain(
      "Provider",
    );
    expect(screen.getByText("AI outside the financial decision path")).toBeTruthy();
    expect(screen.getByText("NO DATA")).toBeTruthy();
    expect(screen.queryByText(/uptime/i)).toBeNull();
    expect(screen.queryByText(/99\.99/)).toBeNull();
    expect(
      screen.getByRole("link", { name: "RUN GOLDEN DEMO" }).getAttribute("href"),
    ).toBe("/demo");
  });

  it("shows persisted counts from the metrics API", async () => {
    const api = createMockApi({
      getMetricsSummary: vi.fn(async () => sampleMetricsPopulated),
    });
    render(<App api={api} initialHref="/" />);
    expect(await screen.findByText("Events processed")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("Duplicates detected")).toBeTruthy();
    expect(screen.getByText("Retries succeeded")).toBeTruthy();
    expect(screen.queryByText("NO DATA")).toBeNull();
    expect(api.getMetricsSummary).toHaveBeenCalled();
  });

  it("shows an error without implying financial mutation", async () => {
    const api = createMockApi({
      getMetricsSummary: vi.fn(async () => {
        throw new ApiError(
          "REQUEST_FAILED",
          "corr-overview",
          500,
          "UNABLE TO LOAD OVERVIEW",
        );
      }),
    });
    render(<App api={api} initialHref="/" />);
    expect(await screen.findByText("UNABLE TO LOAD OVERVIEW")).toBeTruthy();
    expect(screen.getByText("corr-overview")).toBeTruthy();
    expect(
      screen.getByText("This operator request did not change payment or ledger state."),
    ).toBeTruthy();
    expect(sampleMetricsEmpty.persisted.webhookEvents).toBe(0);
  });
});
