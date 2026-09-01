/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import {
  PAYMENT_ID,
  createMockApi,
  samplePaymentListItem,
} from "../test-support/fixtures";
import "../test-support/cleanup";

describe("payment index", () => {
  it("renders persisted payments from the API", async () => {
    const api = createMockApi();
    render(<App api={api} initialHref="/payments" />);
    expect(await screen.findByRole("link", { name: PAYMENT_ID })).toBeTruthy();
    expect(screen.getByText("CAPTURED")).toBeTruthy();
    expect(screen.getAllByText("SYNTHETIC").length).toBeGreaterThan(0);
    expect(screen.getByText("1")).toBeTruthy();
    expect(api.listPayments).toHaveBeenCalledWith({});
  });

  it("searches by payment ID through the API", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/payments" />);
    await screen.findByRole("link", { name: PAYMENT_ID });
    await user.type(screen.getByLabelText("Payment ID"), PAYMENT_ID);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => {
      expect(api.listPayments).toHaveBeenLastCalledWith({ q: PAYMENT_ID });
    });
  });

  it("shows a loading state", async () => {
    let finish: ((value: typeof samplePaymentListItem[]) => void) | undefined;
    const pending = new Promise<typeof samplePaymentListItem[]>((resolve) => {
      finish = resolve;
    });
    const api = createMockApi({
      listPayments: vi.fn(async () => pending),
    });
    render(<App api={api} initialHref="/payments" />);
    expect(await screen.findByText("LOADING PAYMENTS…")).toBeTruthy();
    finish?.([samplePaymentListItem]);
    expect(await screen.findByRole("link", { name: PAYMENT_ID })).toBeTruthy();
  });

  it("exposes payment links to the keyboard", async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    render(<App api={api} initialHref="/payments" />);
    const link = await screen.findByRole("link", { name: PAYMENT_ID });
    link.focus();
    expect(document.activeElement).toBe(link);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "PAYMENT" })).toBeTruthy();
  });
});
