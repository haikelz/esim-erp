# Optional Execution Plans

Use this location when the user requests a repository plan or the consumer's
own workflow calls for one. Harness does not require planning or choose a task
lifecycle. Existing plans retain their original intent and evidence.

`docs/templates/exec-plan.md` is an optional starting point. `active/` and
`completed/` are available locations; code, tests, decisions, and Git history
remain the owners of lasting implementation knowledge.

The local `IMPLEMENTATION.md` note remains ignored by Git. Do not copy it into
another location or create a second task tracker. Versioned scope and remaining
integration boundaries are in the [product contract](../../PRODUCT.md) and
[application README](../../README.md).
