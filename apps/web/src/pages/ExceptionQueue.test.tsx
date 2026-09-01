/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../App";
import { createMockApi, sampleException } from "../test-support/fixtures";
import "../test-support/cleanup";

describe("exception queue", () => {
  it("renders exception rows from the API", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/exceptions" />);
    expect(await screen.findByRole("link", { name: /CONFLICTING_EVENT/ })).toBeTruthy();
    expect(screen.getByText("SYNTHETIC:pay:ui-console")).toBeTruthy();
    expect(screen.getAllByText("ERROR").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OPEN").length).toBeGreaterThan(0);
    expect(screen.getByText("14:02:18")).toBeTruthy();
    expect(api.listExceptions).toHaveBeenCalledWith({ status: "OPEN" });
  });

  it("applies filters through the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/exceptions" />);
    await screen.findByRole("link", { name: /CONFLICTING_EVENT/ });
    await user.selectOptions(screen.getByLabelText("Severity"), "ERROR");
    await user.selectOptions(screen.getByLabelText("Status"), "OPEN");
    await user.type(screen.getByLabelText("Provider"), "SYNTHETIC");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(api.listExceptions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "OPEN",
          severity: "ERROR",
          provider: "SYNTHETIC",
        }),
      );
    });
  });

  it("searches payment, webhook, and exception identifiers through the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/exceptions" />);
    await screen.findByRole("link", { name: /CONFLICTING_EVENT/ });
    await user.type(
      screen.getByLabelText("Search IDs"),
      sampleException.exceptionId,
    );
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(api.listExceptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: sampleException.exceptionId }),
      );
    });
  });

  it("shows a factual empty state", async () => {
    const api = createMockApi({
      listExceptions: async () => [],
    });
    render(<App api={api} initialHref="/exceptions" />);
    expect(await screen.findByText("NO OPEN EXCEPTIONS")).toBeTruthy();
    expect(screen.queryByText(/caught up/i)).toBeNull();
  });

  it("labels synthetic simulator rows", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/exceptions" />);
    expect(await screen.findAllByText("SYNTHETIC")).toBeTruthy();
  });

  it("exposes filter and queue actions to the keyboard", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/exceptions" />);
    const apply = await screen.findByRole("button", { name: "Apply" });
    apply.focus();
    expect(document.activeElement).toBe(apply);
    const link = screen.getByRole("link", { name: /CONFLICTING_EVENT/ });
    link.focus();
    expect(document.activeElement).toBe(link);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "EXCEPTION" })).toBeTruthy();
  });
});
