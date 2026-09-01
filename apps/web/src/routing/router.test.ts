import { describe, expect, it } from "vitest";
import { parseRoute } from "./router";

describe("parseRoute", () => {
  it("maps the operator paths that exist", () => {
    expect(parseRoute("/")).toEqual({ name: "overview" });
    expect(parseRoute("/exceptions", "?status=OPEN")).toEqual({
      name: "exceptions",
      search: "?status=OPEN",
    });
    expect(parseRoute("/exceptions/abc")).toEqual({
      name: "exception",
      id: "abc",
    });
    expect(parseRoute("/incidents")).toEqual({
      name: "incidents",
      search: "",
    });
    expect(parseRoute("/incidents/abc")).toEqual({
      name: "incident",
      id: "abc",
    });
    expect(parseRoute("/payments")).toEqual({
      name: "payments",
      search: "",
    });
    expect(parseRoute("/payments", "?q=pay-1")).toEqual({
      name: "payments",
      search: "?q=pay-1",
    });
    expect(parseRoute("/payments/SYNTHETIC:pay:1")).toEqual({
      name: "payment",
      paymentId: "SYNTHETIC:pay:1",
    });
    expect(parseRoute("/events")).toEqual({
      name: "events",
      search: "",
    });
    expect(parseRoute("/events/abc")).toEqual({
      name: "event",
      webhookEventId: "abc",
    });
    expect(parseRoute("/failure-lab")).toEqual({
      name: "failure-lab",
    });
  });
});
