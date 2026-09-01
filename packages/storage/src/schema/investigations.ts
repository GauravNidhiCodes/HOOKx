import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { InvestigationResult } from "@hookx/investigation";
import { exceptions } from "./exceptions.js";

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exceptionId: uuid("exception_id").notNull(),
    investigator: text("investigator").notNull(),
    modelId: text("model_id"),
    promptVersion: text("prompt_version").notNull(),
    result: jsonb("result").$type<InvestigationResult>().notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    correlationId: text("correlation_id").notNull(),
  },
  (table) => [
    index("investigations_exception_created_idx").on(
      table.exceptionId,
      table.createdAt,
    ),
    foreignKey({
      name: "investigations_exception_id_exceptions_id_fk",
      columns: [table.exceptionId],
      foreignColumns: [exceptions.id],
    }).onDelete("restrict"),
    check(
      "investigations_investigator_present",
      sql`char_length(${table.investigator}) > 0`,
    ),
  ],
);
