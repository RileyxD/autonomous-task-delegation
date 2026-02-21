# Autonomous Delegation Daemon

Repository-agnostic autonomous task delegation for AI CLI tools (Claude, Codex, and others).

## Features
- Continuous daemon that monitors a file-based task queue.
- Automatic agent/tool detection and routing.
- Optional isolated git worktree per task.
- Structured logs and run artifacts for traceability.
- Works in any git repository.

## CLI commands
- `autodelegate-init`
- `autodelegate-submit`
- `autodelegate-status`
- `autodelegate-daemon`

## Quick start
1. Install dependencies:
```bash
npm ci
```
2. Initialize a home directory in your repo root:
```bash
autodelegate-init
```
3. Queue a task:
```bash
autodelegate-submit --title "OAuth hardening" --prompt "Implement token refresh flow and tests."
```
4. Run the daemon:
```bash
autodelegate-daemon
```

## Home directory
Default home path is `.autodelegate` under the current git repository root.

Override with:
- `--home <path>`
- `AUTO_DELEGATE_HOME`

## Agent configuration
Agent files live in `<home>/agents/*.agent.json`.

Minimum fields:
- `name`
- `command`

Common optional fields:
- `enabled`
- `promptMode` (`argument` or `stdin`)
- `defaultArgs`
- `useWorktree`
- `env`

Template files:
- `templates/agents/claude.agent.json`
- `templates/agents/codex.agent.example.json`

## Task configuration
Task files are JSON in `<home>/inbox`.

Minimum fields:
- `title`
- `prompt`

Template file:
- `templates/task.example.json`

## Routing logic
Priority order:
1. task `agent`
2. task `tool`
3. `routingOrder` in `<home>/orchestrator.config.json`
4. first installed enabled agent

## Outputs
- Queue directories: `inbox`, `processing`, `completed`, `failed`
- Run artifacts: `<home>/runs/<timestamp>-<task-id>/`
- Event log: `<home>/daemon.log`

## Validation
```bash
npm run lint
npm run test
```

## Publishing and sharing
- This directory is designed to be pushed as its own GitHub repository.
- Include tags for releases and keep `CHANGELOG.md` updated.

## License
MIT. See `LICENSE`.
