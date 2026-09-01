/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { App } from "../App";
import {
  EXCEPTION_ID,
  createMockApi,
  sampleFailureLabCatalog,
  sampleFailureLabRun,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("failure lab", () => {
  it("labels the environment as synthetic and lists scenarios", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/failure-lab" />);
    expect(
      await screen.findByRole("heading", { name: "SYNTHETIC FAILURE LAB" }),
    ).toBeTruthy();
    expect(
      screen.getByText("The Failure Lab never sends real payment requests."),
    ).toBeTruthy();
    expect(screen.getByText(/01 — DUPLICATE DELIVERY/)).toBeTruthy();
    expect(screen.getByText(/06 — REPLAY RECOVERY/)).toBeTruthy();
    expect(screen.getAllByText("NOT RUN").length).toBe(6);
    expect(api.getFailureLabCatalog).toHaveBeenCalled();
  });

  it("shows a loading state", async () => {
    let finish: ((value: typeof sampleFailureLabCatalog) => void) | undefined;
    const pending = new Promise<typeof sampleFailureLabCatalog>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      getFailureLabCatalog: vi.fn(async () => pending),
    });
    render(<App api={api} initialHref="/failure-lab" />);
    expect(await screen.findByText("LOADING FAILURE LAB…")).toBeTruthy();
    finish?.(sampleFailureLabCatalog);
    expect(await screen.findByText(/01 — DUPLICATE DELIVERY/)).toBeTruthy();
  });

  it("runs a scenario and renders the execution report from the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/failure-lab" />);
    await screen.findByRole("heading", { name: "SYNTHETIC FAILURE LAB" });
    expect(screen.queryByText("RUN RESULT")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Run DUPLICATE DELIVERY" }));
    await waitFor(() => {
      expect(api.runFailureLab).toHaveBeenCalledWith("DUPLICATE_DELIVERY");
    });
    expect(await screen.findByText("RUN RESULT")).toBeTruthy();
    expect(screen.getByText("2 webhook deliveries")).toBeTruthy();
    expect(
      screen.getAllByText(/1 accepted · 1 duplicate · 0 conflict · 0 error/)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("EXECUTION LOG")).toBeTruthy();
    expect(screen.getAllByText("14:21:03").length).toBeGreaterThan(0);
    expect(screen.getByText("WEBHOOK RECEIVED")).toBeTruthy();
    expect(screen.getByText("DUPLICATE DETECTED")).toBeTruthy();
    expect(screen.getByRole("link", { name: "VIEW INCIDENT" }).getAttribute("href")).toBe(
      `/incidents/${EXCEPTION_ID}`,
    );
  });

  it("shows an executing state while the run is in flight", async () => {
    const user = userEvent.setup();
    let finish: ((value: typeof sampleFailureLabRun) => void) | undefined;
    const pending = new Promise<typeof sampleFailureLabRun>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      runFailureLab: vi.fn(async () => pending),
    });
    render(<App api={api} initialHref="/failure-lab" />);
    await screen.findByRole("heading", { name: "SYNTHETIC FAILURE LAB" });
    await user.click(screen.getByRole("button", { name: "Run DUPLICATE DELIVERY" }));
    expect(await screen.findByText("EXECUTING")).toBeTruthy();
    finish?.(sampleFailureLabRun);
    expect(await screen.findByText("RUN RESULT")).toBeTruthy();
  });

  it("shows a run failure from the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi({
      runFailureLab: vi.fn(async () => {
        throw new ApiError(
          "UNKNOWN_FAILURE_LAB_SCENARIO",
          "corr-lab-err",
          400,
          "UNABLE TO RUN FAILURE LAB SCENARIO",
        );
      }),
    });
    render(<App api={api} initialHref="/failure-lab" />);
    await screen.findByRole("heading", { name: "SYNTHETIC FAILURE LAB" });
    await user.click(screen.getByRole("button", { name: "Run DUPLICATE DELIVERY" }));
    expect(await screen.findByText("UNABLE TO RUN FAILURE LAB SCENARIO")).toBeTruthy();
    expect(screen.getByText("corr-lab-err")).toBeTruthy();
    expect(screen.queryByText("RUN RESULT")).toBeNull();
  });

  it("requires confirmation before reset", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/failure-lab" />);
    await screen.findByRole("heading", { name: "SYNTHETIC FAILURE LAB" });
    await user.click(screen.getByRole("button", { name: "RESET LAB" }));
    const confirm = screen.getByRole("button", { name: "CONFIRM RESET" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      screen.getByLabelText(/Type SYNTHETIC_FAILURE_LAB to confirm/),
      "SYNTHETIC_FAILURE_LAB",
    );
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => {
      expect(api.resetFailureLab).toHaveBeenCalledWith("SYNTHETIC_FAILURE_LAB");
    });
  });
});
