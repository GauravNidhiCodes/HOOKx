# Documentation

Index of technical documents that exist in this repository.

| Document | Subject |
| --- | --- |
| [architecture.md](architecture.md) | System boundaries and data flow |
| [reviewer-guide.md](reviewer-guide.md) | Razorpay-facing questions, terminology, before production |
| [api.md](api.md) | Implemented HTTP endpoints |
| [error-codes.md](error-codes.md) | HTTP and exception codes actually used |
| [observability.md](observability.md) | Logs, correlation ids, incident timelines, metrics policy |
| [failure-lab.md](failure-lab.md) | Synthetic Failure Lab scenarios and injection rules |
| [ai-investigator.md](ai-investigator.md) | Read-only AI investigation |
| [demo.md](demo.md) | End-to-end architecture demonstration (Failure Lab TRANSIENT FAILURE) |
| [golden-demo.md](golden-demo.md) | Golden Demo (`/demo`) — Razorpay-shaped fail-once through the real pipeline |
| [test-matrix.md](test-matrix.md) | Scenario → expected behavior → automated test |
| [local-synthetic-benchmark.md](local-synthetic-benchmark.md) | LOCAL SYNTHETIC BENCHMARK (not an SLA) |
| [operator-console.md](operator-console.md) | Operator UI contracts |
| [razorpay.md](razorpay.md) | Pointer to the Razorpay adapter document |
| [providers/razorpay.md](providers/razorpay.md) | Razorpay adapter: contract, signature, fixtures, limitations |
| [simulation.md](simulation.md) | Synthetic simulator CLI |
| [security.md](security.md) | Secrets, signatures, logging, scoped reset, unauthenticated local API |
| [../apps/api/README.md](../apps/api/README.md) | HTTP ingest internals (see also [api.md](api.md)) |

Package READMEs (`packages/*/README.md`) cover domain, state machine, storage, webhook, audit, exceptions, and investigation internals.
