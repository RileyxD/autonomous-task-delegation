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
Shared agent templates are auto-loaded from:
- `$CODEX_HOME/tools/autonomous-delegation/templates/agents`
- fallback: `$HOME/.codex/tools/autonomous-delegation/templates/agents`

Project-local override files can be added in `<home>/agents/*.agent.json`.
If a local file has the same `name` as a shared one, local overrides shared.
This is the recommended place to change model or permission flags per project.

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
- `templates/agents/claude-general-purpose.agent.json`
- `templates/agents/claude-explore.agent.json`
- `templates/agents/claude-plan.agent.json`
- `templates/agents/claude-bash.agent.json`
- `templates/agents/claude-code-guide.agent.json`

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

You can disable shared agents with:
- `AUTO_DELEGATE_DISABLE_GLOBAL_AGENTS=1`

## Claude subagents
If your Claude Code environment supports subagents, you can route tasks by setting task `agent` to:
- `claude-general-purpose`
- `claude-explore`
- `claude-plan`
- `claude-bash`
- `claude-code-guide`

Example:
```bash
autodelegate-submit --title "Find publish route usages" --prompt "Find all usages of publish/project and summarize." --agent claude-explore
```

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
