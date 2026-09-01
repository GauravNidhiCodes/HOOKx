import { describe, expect, it } from "vitest";
import {
  defaultTestDatabaseUrl,
  parseDatabaseName,
  quotePgIdent,
  redactDatabaseUrl,
  toMaintenanceDatabaseUrl,
} from "./config.js";
import { StorageError } from "./errors.js";

describe("database configuration", () => {
  it("redacts a password in a URL", () => {
    expect(
      redactDatabaseUrl("postgres://hookx:s3cret@127.0.0.1:5432/hookx"),
    ).toBe("postgres://hookx:***@127.0.0.1:5432/hookx");
  });

  it("parses and rejects unsafe database names", () => {
    expect(parseDatabaseName("postgres://localhost/hookx_test")).toBe(
      "hookx_test",
    );
    expect(() => parseDatabaseName("postgres://localhost/postgres")).toThrow(
      StorageError,
    );
    expect(() => parseDatabaseName("postgres://localhost/template1")).toThrow(
      StorageError,
    );
    expect(() =>
      parseDatabaseName("postgres://localhost/hookx;drop"),
    ).toThrow(StorageError);
  });

  it("quotes validated database names as Postgres identifiers", () => {
    expect(quotePgIdent("hookx_test")).toBe('"hookx_test"');
    expect(() => quotePgIdent("hookx;drop")).toThrow(StorageError);
  });

  it("points maintenance connections at the postgres database", () => {
    expect(
      toMaintenanceDatabaseUrl("postgres://u@127.0.0.1:5432/hookx_test"),
    ).toBe("postgres://u@127.0.0.1:5432/postgres");
  });

  it("uses HOOKX_TEST_DATABASE_URL when set", () => {
    expect(
      defaultTestDatabaseUrl({
        HOOKX_TEST_DATABASE_URL: "postgres://ci@127.0.0.1:5432/hookx_ci",
      }),
    ).toBe("postgres://ci@127.0.0.1:5432/hookx_ci");
  });
});
