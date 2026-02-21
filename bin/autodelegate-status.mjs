#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function usage() {
  console.log(`Usage:
  autodelegate-status [--home <path>]

Env:
  AUTO_DELEGATE_HOME      Home directory path override
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

function countJson(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  return fs.readdirSync(dirPath).filter((name) => name.endsWith('.json')).length;
}

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

let homeArg = '';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const key = args[i];
  if (key === '--help' || key === '-h') {
    usage();
    process.exit(0);
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

const inboxDir = path.join(homeDir, 'inbox');
const processingDir = path.join(homeDir, 'processing');
const completedDir = path.join(homeDir, 'completed');
const failedDir = path.join(homeDir, 'failed');
const agentsDir = path.join(homeDir, 'agents');

console.log('Autodelegate status');
console.log(`Repo: ${repoRoot}`);
console.log(`Home: ${homeDir}`);
console.log(`Inbox: ${countJson(inboxDir)}`);
console.log(`Processing: ${countJson(processingDir)}`);
console.log(`Completed: ${countJson(completedDir)}`);
console.log(`Failed: ${countJson(failedDir)}`);

if (!fs.existsSync(agentsDir)) {
  process.exit(0);
}

const agentFiles = fs.readdirSync(agentsDir).filter((name) => name.endsWith('.agent.json')).sort();
if (!agentFiles.length) {
  process.exit(0);
}

console.log('Agents:');
for (const fileName of agentFiles) {
  const fullPath = path.join(agentsDir, fileName);
  try {
    const agent = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const enabled = agent.enabled !== false;
    const installed = commandExists(String(agent.command || ''));
    console.log(
      `- ${agent.name || fileName}: enabled=${enabled} command=${agent.command || 'n/a'} installed=${installed}`,
    );
  } catch {
    console.log(`- ${fileName}: invalid JSON`);
  }
}
