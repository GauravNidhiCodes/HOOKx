import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it("maps the operator paths that exist", () => {
    expect(parseRoute("/exceptions", "?status=OPEN")).toEqual({
      name: "exceptions",
      search: "?status=OPEN",
    });
    expect(parseRoute("/exceptions/abc")).toEqual({
      name: "exception",
      id: "abc",
    });
    expect(parseRoute("/payments")).toEqual({
      name: "payments",
      paymentId: null,
    });
    expect(parseRoute("/payments/SYNTHETIC:pay:1")).toEqual({
      name: "payments",
      paymentId: "SYNTHETIC:pay:1",
    });
    expect(parseRoute("/events")).toEqual({
      name: "events",
      webhookEventId: null,
    });
  });
});
