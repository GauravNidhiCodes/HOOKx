/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "../components/CopyButton";
import "../test-support/cleanup";

describe("CopyButton", () => {
  it("copies the value and confirms in text", async () => {
    const writeText = vi.fn(async () => undefined);
    const clipboard = navigator.clipboard;
    if (clipboard !== undefined && typeof clipboard.writeText === "function") {
      vi.spyOn(clipboard, "writeText").mockImplementation(writeText);
    } else {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });
    }
    render(<CopyButton value="corr-1" label="correlation ID" />);
    const button = screen.getByRole("button", { name: "Copy correlation ID" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith("corr-1");
    expect(await screen.findByText("Copied")).toBeTruthy();
  });
});
