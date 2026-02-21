#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function usage() {
  console.log(`Usage:
  autodelegate-submit --title <text> --prompt <text> [options]

Options:
  --title <text>          Task title.
  --prompt <text>         Prompt to send to delegated AI CLI.
  --agent <name>          Preferred agent name.
  --tool <command>        Preferred CLI tool command.
  --cwd <path>            Working directory for task execution.
  --max-attempts <n>      Retry attempts (default: 2).
  --id <id>               Custom task id.
  --home <path>           Home directory override.
  --help                  Show help.

Env:
  AUTO_DELEGATE_HOME      Home directory path override
`);
}

function slugify(value) {
  return String(value || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task';
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

const args = process.argv.slice(2);
const task = {
  maxAttempts: 2,
};
let homeArg = '';

for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  const value = args[i + 1];

  if (key === '--help' || key === '-h') {
    usage();
    process.exit(0);
  }

  if (key === '--home') {
    if (!value || value.startsWith('--')) {
      console.error('Missing value for --home');
      process.exit(1);
    }
    homeArg = value;
    i += 1;
    continue;
  }

  if (!value || value.startsWith('--')) {
    console.error(`Missing value for ${key}`);
    usage();
    process.exit(1);
  }

  switch (key) {
    case '--title':
      task.title = value;
      i += 1;
      break;
    case '--prompt':
      task.prompt = value;
      i += 1;
      break;
    case '--agent':
      task.agent = value;
      i += 1;
      break;
    case '--tool':
      task.tool = value;
      i += 1;
      break;
    case '--cwd':
      task.cwd = value;
      i += 1;
      break;
    case '--max-attempts':
      task.maxAttempts = Number(value);
      i += 1;
      break;
    case '--id':
      task.id = value;
      i += 1;
      break;
    default:
      console.error(`Unknown argument: ${key}`);
      usage();
      process.exit(1);
  }
}

if (!task.title || !task.prompt) {
  console.error('Both --title and --prompt are required.');
  usage();
  process.exit(1);
}

if (!Number.isFinite(task.maxAttempts) || task.maxAttempts < 1) {
  console.error('--max-attempts must be a positive number.');
  process.exit(1);
}

const repoRoot = getRepoRoot();
const homeDir = resolveHome(repoRoot, homeArg);
const inboxDir = path.join(homeDir, 'inbox');
fs.mkdirSync(inboxDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
const id = task.id || `${slugify(task.title)}-${stamp}`;
const filePath = path.join(inboxDir, `${stamp}-${slugify(id)}.json`);

const payload = {
  id,
  title: task.title,
  prompt: task.prompt,
  agent: task.agent,
  tool: task.tool,
  cwd: task.cwd,
  maxAttempts: task.maxAttempts,
  attempt: 0,
  createdAt: new Date().toISOString(),
};

for (const key of Object.keys(payload)) {
  if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
    delete payload[key];
  }
}

fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`Queued task: ${filePath}`);
console.log(`Task id: ${id}`);
