#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function usage() {
  console.log(`Usage:
  autodelegate-init [--home <path>] [--force]

Creates reusable autonomous delegation scaffold:
- orchestrator.config.json
- inbox/processing/completed/failed directories
- local agents override directory (optional)
`);
}

function getRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    return process.cwd();
  }
  return result.stdout.trim();
}

function resolveHome(repoRoot, cliHome) {
  const raw = cliHome || process.env.AUTO_DELEGATE_HOME || '.autodelegate';
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(repoRoot, raw);
}

function writeFileIfMissing(filePath, content, force) {
  if (!force && fs.existsSync(filePath)) {
    return false;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

let homeArg = '';
let force = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (key === '--help' || key === '-h') {
    usage();
    process.exit(0);
  }
  if (key === '--force') {
    force = true;
    continue;
  }
  if (key === '--home') {
    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      console.error('Missing value for --home');
      process.exit(1);
    }
    homeArg = value;
    i += 1;
    continue;
  }
  console.error(`Unknown argument: ${key}`);
  process.exit(1);
}

const repoRoot = getRepoRoot();
const homeDir = resolveHome(repoRoot, homeArg);

const dirs = ['inbox', 'processing', 'completed', 'failed', 'runs', 'worktrees', 'agents'];
for (const dirName of dirs) {
  const full = path.join(homeDir, dirName);
  fs.mkdirSync(full, { recursive: true });
  if (['inbox', 'processing', 'completed', 'failed', 'agents'].includes(dirName)) {
    writeFileIfMissing(path.join(full, '.gitkeep'), '', force);
  }
}

writeFileIfMissing(
  path.join(homeDir, 'orchestrator.config.json'),
  `${JSON.stringify(
    {
      pollIntervalMs: 5000,
      defaultMaxAttempts: 2,
      routingOrder: [
        'claude-general-purpose',
        'claude-explore',
        'claude-plan',
        'claude-bash',
        'claude-code-guide',
        'claude-generalist',
      ],
      cleanupWorktreeOnSuccess: false,
      cleanupWorktreeOnFailure: false,
    },
    null,
    2,
  )}\n`,
  force,
);

writeFileIfMissing(
  path.join(homeDir, 'agents', 'README.md'),
  `# Local Agent Overrides

This folder is optional.

Autodelegate automatically loads shared agent templates from:
- $CODEX_HOME/tools/autonomous-delegation/templates/agents
- or $HOME/.codex/tools/autonomous-delegation/templates/agents

Any \`.agent.json\` file here overrides shared agent definitions with the same \`name\`.
`,
  force,
);

console.log(`Initialized autodelegate home: ${homeDir}`);
console.log('Shared agents are loaded from Codex templates by default.');
console.log('Use local agents/ only for project-specific overrides, then run autodelegate-daemon.');
