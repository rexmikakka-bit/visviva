# Axis project guidance

Read [CLAUDE.md](CLAUDE.md) for project constraints, architecture, validation, and
the current handoff before working in this repository. Its project rules apply
regardless of which agent is doing the work.

If you are picking up the abyssal / MutaMarket work, the live state is the
**"Pick-up-here handoff"** section at the end of
[docs/abyssal-handoff.md](docs/abyssal-handoff.md): the remaining backlog (#20–#24),
how far #20 got, and what is uncommitted.

For any user-facing UI change, also read [docs/ui-conventions.md](docs/ui-conventions.md).
Start from the closest existing Axis screen and reuse its components and interaction
patterns. A feature request is not a request to redesign the app. State the existing
screen/component you will follow before implementing the UI.

Functional verification and visual verification are separate requirements. Compare
the changed screen with its existing reference in the running app at the same viewport
and theme; report what was actually inspected and any remaining gaps.
