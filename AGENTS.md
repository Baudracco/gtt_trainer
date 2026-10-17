# Agent guide
- Start by reading docs/PROJECT_STATUS.md. It is the maintained handoff: implemented features, verified checkpoint, open work and known pitfalls. Inspect only subsequent commits and the area needed for the task instead of rediscovering the whole project.
- Update docs/PROJECT_STATUS.md in every PR that changes behavior, verification evidence, blockers or the next task. Distinguish planned, implemented, CI-verified and field-verified work. Never mark a pending item complete without evidence.
- Treat docs/ARCHITECTURE.md and docs/ROADMAP.md as design references.
- Branch from current main; PR directly to main; no stacked PRs.
- Never replace fixed route geometry using shortest-path routing.
- Preserve ordered variant-specific stop membership and revision history.
- No secrets in code. Update docs, migrations and tests with behavior changes.
- Review GTT licensing/attribution and street geometry against official evidence before publishing.
