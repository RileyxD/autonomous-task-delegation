#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const DEFAULT_CONFIG = {
  pollIntervalMs: 5000,
  defaultMaxAttempts: 2,
  routingOrder: [],
  cleanupWorktreeOnSuccess: false,
  cleanupWorktreeOnFailure: false,
};

function usage() {
  console.log(`Usage:
  autodelegate-daemon [options]

Options:
  --home <path>            Override home directory (default: .autodelegate in repo root)
  --poll-ms <number>       Override poll interval in milliseconds
  --once                   Process one available task and exit
  --help                   Show help

Env:
  AUTO_DELEGATE_HOME              Home directory path override
  AUTO_DELEGATE_BRANCH_PREFIX     Worktree branch prefix (default: autodelegate/)
  AUTO_DELEGATE_GLOBAL_AGENTS_DIR Global shared agents directory override
  AUTO_DELEGATE_DISABLE_GLOBAL_AGENTS Set to "1" to disable shared agents
`);
}

function parseArgs(argv) {
  const options = {
    home: '',
    pollMs: 0,
    once: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--help' || key === '-h') {
      usage();
      process.exit(0);
    }
    if (key === '--once') {
      options.once = true;
      continue;
    }
    if (key === '--home' || key === '--poll-ms') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${key}`);
      }
      if (key === '--home') {
        options.home = value;
      } else {
        options.pollMs = Number(value);
      }
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${key}`);
  }

  if (options.pollMs && (!Number.isFinite(options.pollMs) || options.pollMs < 100)) {
    throw new Error('--poll-ms must be a number >= 100');
  }

  return options;
}

function nowIso() {
  return new Date().toISOString();
}

function tsCompact() {
  return new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
}

function slugify(value) {
  return String(value || 'task')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'task';
}

function log(message, extra) {
  const line = `[${nowIso()}] ${message}`;
  console.log(line);
  if (extra) {
    console.log(extra);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFiles(dirPath, suffix) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(suffix))
    .sort((a, b) => a.localeCompare(b));
}

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
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

function resolveCodexHome() {
  return process.env.CODEX_HOME || path.join(process.env.HOME || '', '.codex');
}

function resolveGlobalAgentsDir() {
  const override = process.env.AUTO_DELEGATE_GLOBAL_AGENTS_DIR;
  if (override && override.length > 0) {
    return path.isAbsolute(override) ? override : path.resolve(process.cwd(), override);
  }

  return path.join(resolveCodexHome(), 'tools', 'autonomous-delegation', 'templates', 'agents');
}

function branchPrefix() {
  const raw = process.env.AUTO_DELEGATE_BRANCH_PREFIX || 'autodelegate/';
  return raw.endsWith('/') ? raw : `${raw}/`;
}

function moveFileToDir(sourcePath, targetDir, prefix) {
  ensureDir(targetDir);
  const baseName = path.basename(sourcePath);
  const targetName = `${prefix}-${baseName}`;
  const targetPath = path.join(targetDir, targetName);
  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

function appendEvent(logPath, payload) {
  fs.appendFileSync(logPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const parsed = readJson(configPath);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error) {
    log(`Invalid config file at ${configPath}; using defaults.`, String(error));
    return { ...DEFAULT_CONFIG };
  }
}

function loadAgents(agentsDirs) {
  const byName = new Map();

  for (const agentsDir of agentsDirs) {
    if (!agentsDir || !fs.existsSync(agentsDir)) {
      continue;
    }

    const files = listFiles(agentsDir, '.agent.json');
    for (const fileName of files) {
      const fullPath = path.join(agentsDir, fileName);
      try {
        const agent = readJson(fullPath);
        if (agent.enabled === false) {
          continue;
        }
        if (!agent.name || !agent.command) {
          log(`Skipping invalid agent config: ${fullPath}`);
          continue;
        }
        if (!commandExists(agent.command)) {
          continue;
        }

        byName.set(agent.name, {
          ...agent,
          promptMode: agent.promptMode === 'stdin' ? 'stdin' : 'argument',
          defaultArgs: Array.isArray(agent.defaultArgs) ? agent.defaultArgs.map(String) : [],
          useWorktree: agent.useWorktree !== false,
        });
      } catch (error) {
        log(`Failed to load agent config: ${fullPath}`, String(error));
      }
    }
  }

  return Array.from(byName.values());
}

function pickAgent(task, agents, config) {
  if (!agents.length) {
    return null;
  }

  if (task.agent) {
    const named = agents.find((agent) => agent.name === task.agent);
    if (named) {
      return named;
    }
  }

  if (task.tool) {
    const byTool = agents.find((agent) => agent.command === task.tool);
    if (byTool) {
      return byTool;
    }
  }

  if (Array.isArray(config.routingOrder)) {
    for (const name of config.routingOrder) {
      const found = agents.find((agent) => agent.name === name);
      if (found) {
        return found;
      }
    }
  }

  return agents[0];
}

function createWorktree(repoRoot, worktreesDir, agentName, taskId) {
  ensureDir(worktreesDir);
  const stamp = Date.now();
  const branch = `${branchPrefix()}${slugify(agentName)}-${slugify(taskId)}-${stamp}`;
  const worktreePath = path.join(worktreesDir, branch.replace(/\//g, '__'));
  const result = spawnSync('git', ['worktree', 'add', '-b', branch, worktreePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`git worktree add failed: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return { branch, worktreePath };
}

function cleanupWorktree(repoRoot, worktreePath) {
  const result = spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    log(`Failed to remove worktree ${worktreePath}`, (result.stderr || result.stdout || '').trim());
  }
}

function resolveRunCwd(repoRoot, worktreePath, taskCwd) {
  const base = worktreePath || repoRoot;
  if (!taskCwd) {
    return base;
  }
  if (path.isAbsolute(taskCwd)) {
    return taskCwd;
  }
  return path.resolve(base, taskCwd);
}

function recoverProcessing(processingDir, inboxDir) {
  const stale = listFiles(processingDir, '.json');
  for (const fileName of stale) {
    fs.renameSync(path.join(processingDir, fileName), path.join(inboxDir, `recovered-${fileName}`));
  }
  if (stale.length > 0) {
    log(`Recovered ${stale.length} task(s) from processing back to inbox.`);
  }
}

function runAgent(agent, task, prompt, cwd) {
  const args = [
    ...agent.defaultArgs,
    ...(Array.isArray(task.commandArgs) ? task.commandArgs.map(String) : []),
  ];

  const options = {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      ...(agent.env || {}),
      ...(task.env || {}),
    },
  };

  if (agent.promptMode === 'stdin') {
    return spawnSync(agent.command, args, { ...options, input: prompt });
  }

  return spawnSync(agent.command, [...args, prompt], options);
}

async function processOneTask(context) {
  const { config, dirs, agents, repoRoot, logPath } = context;
  const taskFiles = listFiles(dirs.inbox, '.json');
  if (!taskFiles.length) {
    return false;
  }

  if (!agents.length) {
    log('Tasks pending, but no available agent tools detected.');
    return true;
  }

  const fileName = taskFiles[0];
  const inboxPath = path.join(dirs.inbox, fileName);
  const processingPath = path.join(dirs.processing, fileName);

  try {
    fs.renameSync(inboxPath, processingPath);
  } catch {
    return true;
  }

  const loopStamp = Date.now();
  let task;
  try {
    task = readJson(processingPath);
  } catch (error) {
    const failedPath = moveFileToDir(processingPath, dirs.failed, String(loopStamp));
    appendEvent(logPath, {
      at: nowIso(),
      status: 'failed',
      reason: 'invalid_json',
      file: failedPath,
      error: String(error),
    });
    return true;
  }

  const taskId = task.id || path.basename(fileName, '.json');
  const prompt = typeof task.prompt === 'string' ? task.prompt : '';
  if (!prompt.trim()) {
    const failedPath = moveFileToDir(processingPath, dirs.failed, String(loopStamp));
    appendEvent(logPath, {
      at: nowIso(),
      status: 'failed',
      reason: 'missing_prompt',
      taskId,
      file: failedPath,
    });
    return true;
  }

  const agent = pickAgent(task, agents, config);
  if (!agent) {
    moveFileToDir(processingPath, dirs.inbox, `waiting-${loopStamp}`);
    return true;
  }

  const runDir = path.join(dirs.runs, `${tsCompact()}-${slugify(taskId)}`);
  ensureDir(runDir);
  fs.writeFileSync(path.join(runDir, 'task.json'), `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(runDir, 'prompt.txt'), `${prompt}\n`, 'utf8');

  const startedAt = Date.now();
  let worktree = null;

  try {
    if (agent.useWorktree) {
      worktree = createWorktree(repoRoot, dirs.worktrees, agent.name, taskId);
    }

    const runCwd = resolveRunCwd(repoRoot, worktree?.worktreePath || null, task.cwd);
    const result = runAgent(agent, task, prompt, runCwd);

    fs.writeFileSync(path.join(runDir, 'stdout.log'), result.stdout || '', 'utf8');
    fs.writeFileSync(path.join(runDir, 'stderr.log'), result.stderr || '', 'utf8');

    const summary = {
      status: result.status === 0 ? 'completed' : 'failed',
      taskId,
      agent: agent.name,
      tool: agent.command,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: nowIso(),
      durationMs: Date.now() - startedAt,
      exitCode: result.status,
      signal: result.signal,
      runDir,
      worktree: worktree?.worktreePath || null,
      branch: worktree?.branch || null,
    };
    writeJson(path.join(runDir, 'summary.json'), summary);

    const maxAttempts = Number(task.maxAttempts ?? config.defaultMaxAttempts ?? 1);
    const attempt = Number(task.attempt ?? 0);

    if (result.status === 0) {
      const completedPath = moveFileToDir(processingPath, dirs.completed, String(Date.now()));
      appendEvent(logPath, {
        at: nowIso(),
        status: 'completed',
        taskId,
        taskFile: completedPath,
        runDir,
        agent: agent.name,
        tool: agent.command,
        branch: worktree?.branch || null,
      });
      if (config.cleanupWorktreeOnSuccess && worktree) {
        cleanupWorktree(repoRoot, worktree.worktreePath);
      }
      return true;
    }

    if (attempt + 1 < maxAttempts) {
      task.attempt = attempt + 1;
      task.lastError = (result.stderr || `exit_${result.status}`).slice(0, 5000);
      task.lastTriedAt = nowIso();
      writeJson(processingPath, task);
      const requeuedPath = moveFileToDir(processingPath, dirs.inbox, `retry-${Date.now()}`);
      appendEvent(logPath, {
        at: nowIso(),
        status: 'retrying',
        taskId,
        attempt: task.attempt,
        maxAttempts,
        taskFile: requeuedPath,
        runDir,
        agent: agent.name,
      });
      if (config.cleanupWorktreeOnFailure && worktree) {
        cleanupWorktree(repoRoot, worktree.worktreePath);
      }
      return true;
    }

    const failedPath = moveFileToDir(processingPath, dirs.failed, String(Date.now()));
    appendEvent(logPath, {
      at: nowIso(),
      status: 'failed',
      reason: `exit_${result.status}`,
      taskId,
      taskFile: failedPath,
      runDir,
      agent: agent.name,
      tool: agent.command,
      branch: worktree?.branch || null,
    });
    if (config.cleanupWorktreeOnFailure && worktree) {
      cleanupWorktree(repoRoot, worktree.worktreePath);
    }
    return true;
  } catch (error) {
    const failedPath = moveFileToDir(processingPath, dirs.failed, String(Date.now()));
    appendEvent(logPath, {
      at: nowIso(),
      status: 'failed',
      reason: 'runtime_exception',
      taskId,
      taskFile: failedPath,
      runDir,
      error: String(error),
      agent: agent.name,
      tool: agent.command,
      branch: worktree?.branch || null,
    });
    return true;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = getRepoRoot();
  const homeDir = resolveHome(repoRoot, options.home);

  const dirs = {
    home: homeDir,
    inbox: path.join(homeDir, 'inbox'),
    processing: path.join(homeDir, 'processing'),
    completed: path.join(homeDir, 'completed'),
    failed: path.join(homeDir, 'failed'),
    runs: path.join(homeDir, 'runs'),
    worktrees: path.join(homeDir, 'worktrees'),
    agents: path.join(homeDir, 'agents'),
  };

  const globalAgentsDir = resolveGlobalAgentsDir();

  Object.values(dirs).forEach(ensureDir);

  const configPath = path.join(homeDir, 'orchestrator.config.json');
  const logPath = path.join(homeDir, 'daemon.log');
  recoverProcessing(dirs.processing, dirs.inbox);

  let shouldStop = false;
  process.on('SIGINT', () => {
    shouldStop = true;
  });
  process.on('SIGTERM', () => {
    shouldStop = true;
  });

  log('Autodelegate daemon started.');
  log(`Repo root: ${repoRoot}`);
  log(`Home: ${homeDir}`);
  if (process.env.AUTO_DELEGATE_DISABLE_GLOBAL_AGENTS !== '1') {
    log(`Global agents: ${globalAgentsDir}`);
  }

  while (!shouldStop) {
    const config = loadConfig(configPath);
    const effectivePoll = options.pollMs || Number(config.pollIntervalMs) || 5000;
    const agentSources = process.env.AUTO_DELEGATE_DISABLE_GLOBAL_AGENTS === '1' ? [dirs.agents] : [globalAgentsDir, dirs.agents];
    const agents = loadAgents(agentSources);

    const processed = await processOneTask({
      config,
      dirs,
      agents,
      repoRoot,
      logPath,
    });

    if (options.once) {
      break;
    }

    if (!processed) {
      await sleep(effectivePoll);
    }
  }

  log('Autodelegate daemon stopped.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
