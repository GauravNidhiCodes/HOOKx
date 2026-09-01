/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  EXCEPTION_ID,
  PAYMENT_ID,
  WEBHOOK_ID,
  createMockApi,
  replayIncidentTimeline,
  retryIncidentTimeline,
  sampleIncident,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("incident queue", () => {
  it("renders incident rows from the API", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/incidents" />);
    expect(await screen.findByRole("link", { name: /CONFLICTING_EVENT/ })).toBeTruthy();
    expect(screen.getAllByText("SYNTHETIC").length).toBeGreaterThan(0);
    expect(api.listIncidents).toHaveBeenCalledWith({ status: "OPEN" });
  });

  it("applies filters through the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/incidents" />);
    await screen.findByRole("link", { name: /CONFLICTING_EVENT/ });
    await user.selectOptions(screen.getByLabelText("Severity"), "ERROR");
    await user.type(screen.getByLabelText("Provider"), "SYNTHETIC");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(api.listIncidents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "OPEN",
          severity: "ERROR",
          provider: "SYNTHETIC",
        }),
      );
    });
  });

  it("shows a factual empty state", async () => {
    const api = createMockApi({
      listIncidents: async () => [],
    });
    render(<App api={api} initialHref="/incidents" />);
    expect(await screen.findByText("NO OPEN INCIDENTS")).toBeTruthy();
  });

  it("shows a loading state", async () => {
    let finish: ((value: typeof sampleIncident[]) => void) | undefined;
    const pending = new Promise<typeof sampleIncident[]>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      listIncidents: vi.fn(async () => pending),
    });
    render(<App api={api} initialHref="/incidents" />);
    expect(await screen.findByText("LOADING INCIDENTS…")).toBeTruthy();
    finish?.([sampleIncident]);
    expect(await screen.findByRole("link", { name: /CONFLICTING_EVENT/ })).toBeTruthy();
  });

  it("shows an error state", async () => {
    const api = createMockApi({
      listIncidents: vi.fn(async () => {
        throw new ApiError("REQUEST_FAILED", "corr-inc-err", 500, "UNABLE TO LOAD INCIDENTS");
      }),
    });
    render(<App api={api} initialHref="/incidents" />);
    expect(await screen.findByText("UNABLE TO LOAD INCIDENTS")).toBeTruthy();
    expect(screen.getByText("corr-inc-err")).toBeTruthy();
  });
});

describe("incident detail", () => {
  it("renders incident, payment, event, and timeline", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/incidents/${EXCEPTION_ID}`} />);
    expect(await screen.findByRole("heading", { name: "INCIDENT" })).toBeTruthy();
    expect(screen.getAllByText("CONFLICTING_EVENT").length).toBeGreaterThan(0);
    expect(screen.getByText("TIMELINE")).toBeTruthy();
    expect(screen.getByText("WEBHOOK RECEIVED")).toBeTruthy();
    expect(screen.getByText(/SIGNATURE VERIFIED/)).toBeTruthy();
    expect(screen.getByText(/EVENT PERSISTED/)).toBeTruthy();
    expect(screen.getByText("CONFLICT DETECTED")).toBeTruthy();
    expect(screen.getByText("EXCEPTION CREATED")).toBeTruthy();
    expect(screen.getByText("INVESTIGATION AVAILABLE")).toBeTruthy();
    expect(screen.getByText("SYNTHETIC — simulator data. Does not represent a real customer transaction.")).toBeTruthy();
  });

  it("links payment, event, and exception identifiers", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref={`/incidents/${EXCEPTION_ID}`} />);
    await screen.findByRole("heading", { name: "INCIDENT" });
    expect(
      screen.getByRole("link", { name: PAYMENT_ID }),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: WEBHOOK_ID }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: EXCEPTION_ID }).length,
    ).toBeGreaterThan(0);
  });

  it("renders retry events", async () => {
    const api = createMockApi({
      getIncidentTimeline: vi.fn(async () => ({
        incident: sampleIncident,
        timeline: retryIncidentTimeline,
      })),
    });
    render(<App api={api} initialHref={`/incidents/${EXCEPTION_ID}`} />);
    expect(await screen.findByText("RETRY SCHEDULED")).toBeTruthy();
    expect(screen.getByText("RETRY ATTEMPTED")).toBeTruthy();
    expect(screen.getByText(/ATTEMPT 2/)).toBeTruthy();
  });

  it("renders replay events", async () => {
    const api = createMockApi({
      getIncidentTimeline: vi.fn(async () => ({
        incident: sampleIncident,
        timeline: replayIncidentTimeline,
      })),
    });
    render(<App api={api} initialHref={`/incidents/${EXCEPTION_ID}`} />);
    expect(await screen.findByText("REPLAY STARTED")).toBeTruthy();
    expect(screen.getByText("REPLAY COMPLETED")).toBeTruthy();
    expect(screen.getAllByText(/OUT_OF_ORDER/).length).toBeGreaterThan(0);
  });

  it("shows loading then error", async () => {
    const api = createMockApi({
      getIncident: vi.fn(async () => {
        throw new ApiError(
          "INCIDENT_NOT_FOUND",
          "corr-missing",
          404,
          "UNABLE TO LOAD INCIDENT",
        );
      }),
    });
    render(<App api={api} initialHref={`/incidents/${EXCEPTION_ID}`} />);
    expect(await screen.findByText("UNABLE TO LOAD INCIDENT")).toBeTruthy();
    expect(screen.getByText("corr-missing")).toBeTruthy();
  });

  it("shows an empty timeline", async () => {
    const api = createMockApi({
      getIncidentTimeline: vi.fn(async () => ({
        incident: sampleIncident,
        timeline: [],
      })),
    });
    render(<App api={api} initialHref={`/incidents/${EXCEPTION_ID}`} />);
    expect(
      await screen.findByText("No persisted timeline exists for this incident."),
    ).toBeTruthy();
  });
});
