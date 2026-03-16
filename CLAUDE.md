# Workflow

For every task, run this loop using agents from `.claude/agents/`:

1. **developer** — implement in this order:
   1. Interfaces/types and data contracts
   2. API endpoints/services
   3. Tests
   4. UI and remaining logic
2. **tester** — run all tests, verify developer's work, find issues
3. **director** — evaluate both reports, give verdict

If director's verdict is **NEEDS_REVISION** — repeat from step 1, addressing only the issues director listed.
If **REJECTED** — rethink the approach per director's feedback, repeat from step 1.
If **APPROVED** — done.

Keep iterating until director approves. Max 5 iterations — if not approved by then, stop and report remaining issues to the user.

## Rules
- Pass each agent's full output to the next agent as context.
- Developer fixes only what director flagged — no extra changes.
- Tester must verify with evidence (file paths, line numbers), not assumptions.
- Director must be specific in action items — no vague feedback.
