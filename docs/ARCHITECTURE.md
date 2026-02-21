# Architecture

## Core model
Autodelegate is a file-queue orchestrator with pluggable AI CLI agents.

### Queue states
1. `inbox`: new tasks
2. `processing`: currently executing
3. `completed`: successful tasks
4. `failed`: exhausted retries or invalid payloads

### Agent routing order
1. Task-specific `agent`
2. Task-specific `tool`
3. `routingOrder` in `orchestrator.config.json`
4. First available installed agent

### Execution model
- Each task can run in a dedicated git worktree and branch.
- Prompt is passed either as argument or stdin depending on `promptMode`.
- Output is written to run artifacts (`stdout.log`, `stderr.log`, `summary.json`).

### Reliability features
- Recovery of stranded `processing` tasks on daemon startup.
- Retry support with capped `maxAttempts`.
- Event stream persisted to `daemon.log`.

### Security considerations
- No built-in secret manager; do not place secrets in task prompts.
- Review generated code before merge.
- Prefer least-privilege flags for external AI CLIs.
