import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';

const serverUrl = 'http://127.0.0.1:3000';
const readinessTimeoutMs = 60_000;
const pollIntervalMs = 500;

const executable = (name: string): string => (process.platform === 'win32' ? `${name}.cmd` : name);
const needsShell = process.platform === 'win32';

const quoteWindowsArg = (value: string): string => {
  if (!/[\s"&|<>^]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '\\"')}"`;
};

const spawnCommand = (command: string, args: readonly string[]): ChildProcess => {
  if (needsShell) {
    return spawn([command, ...args].map(quoteWindowsArg).join(' '), {
      env: process.env,
      shell: true,
      stdio: 'inherit',
    });
  }

  return spawn(command, [...args], {
    env: process.env,
    shell: false,
    stdio: 'inherit',
  });
};

const sleep = async (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

export const localServerUrl = serverUrl;

export const runCommand = async (command: string, args: readonly string[]): Promise<number> => {
  const child = spawnCommand(command, args);

  const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
  return code ?? 1;
};

const waitForServer = async (): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < readinessTimeoutMs) {
    try {
      const response = await fetch(serverUrl, { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until the server is ready or the timeout expires.
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(`Next server was not ready within ${String(readinessTimeoutMs)}ms.`);
};

const stopServer = async (server: ChildProcess): Promise<void> => {
  if (server.pid === undefined || server.killed) {
    return;
  }

  if (process.platform === 'win32') {
    await runCommand('taskkill', ['/pid', String(server.pid), '/t', '/f']);
    return;
  }

  server.kill('SIGTERM');
};

export const withNextServer = async (run: () => Promise<number>): Promise<number> => {
  const server = spawnCommand(executable('npm'), ['run', 'start']);

  try {
    await waitForServer();
    return await run();
  } finally {
    await stopServer(server);
  }
};

export const npxExecutable = executable('npx');
