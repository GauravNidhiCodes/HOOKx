# @hookx/simulator

Synthetic webhook scenario catalog and generator.

All simulator events are synthetic and do not represent real payment transactions.

See `docs/simulation.md` for commands, expected behavior, and failure injection.

This package does not call live payment providers. The HTTP runner in `@hookx/api` posts generated deliveries to `POST /webhooks/SYNTHETIC`.
