<!-- AI-GUIDELINES:BEGIN -->
## AI Engineering Guidelines

Read `.agents/general.md` and `.agents/preferences.md` for every task. Then select the smallest matching context profile below. Do not read every installed companion by default. Precedence follows `.agents/general.md` §2: repository-local instructions win, then the `haikel-*` owner profile, then the other guidelines.

- **Repository setup, documentation, planning, CI, or process:** `.agents/harness.md`.
- **JavaScript or TypeScript language/library work:** `.agents/guidelines/javascript-typescript.md` and `.agents/guidelines/haikel-javascript-typescript.md`.
- **Next.js UI or application work:** `.agents/guidelines/javascript-typescript.md`, `.agents/guidelines/haikel-javascript-typescript.md`, and `.agents/guidelines/nextjs.md`.
- **Container, Compose, delivery, or runtime work:** `.agents/guidelines/docker.md`; add an application profile only when its build or runtime behavior also changes.
- **UI, styling, theming, or design-system work:** `.agents/guidelines/design-system.md`; add the framework profile only when its code also changes.
- **Cross-cutting work:** use the union of only the affected profiles and state why each additional document is needed.

### Workspace scopes

Match the changed path first, then use only that workspace's applicable profile.

- `packages/contracts/**`: javascript-typescript.
- `apps/web/**`: javascript-typescript, nextjs, design-system, docker.
- `apps/api/**`: javascript-typescript.
<!-- AI-GUIDELINES:END -->

<!-- HARNESS:BEGIN -->
## Harness

Start with the requested outcome and use the repository as the system of record.
Find the relevant code, interfaces, commands, tests, and evidence through the
repository map in `docs/README.md`. `docs/WORKFLOW.md` describes repository
understanding, missing capabilities, authority, and trust.

- Respect the requested scope. Inspection does not authorize edits or operation.
- Prefer source references over duplicate summaries. Preserve product intent
  and rationale that code and tests do not express.
- Identify missing capabilities needed to act, observe, or verify. Report what
  is unavailable or unproven instead of inventing commands or claiming success.
- Before changing externally observable policy, establish repository authority.
  Stop at material unresolved choices; configurable defaults are not authority.
- Preserve user-owned state and use the repository's native safety and validation
  checks. Explain observed results and their limits.
- Only invoke a Harness skill when the user explicitly requests it.

Consumer repositories own their task workflow and planning. Harness provides
context and optional tools, without a task database or orchestration lifecycle.
<!-- HARNESS:END -->
