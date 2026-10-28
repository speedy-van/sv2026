import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

it('loads the production Metro config through the same Node Metro loader used by EAS', () => {
  const script = String.raw`
    const path = require('node:path');
    const Metro = require('metro-config');
    (async () => {
      const projectRoot = process.cwd();
      const workspaceRoot = path.resolve(projectRoot, '../..');
      const resolved = await Metro.resolveConfig(undefined, projectRoot);
      const config = await Metro.loadConfig({ cwd: projectRoot }, {});
      const rules = Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList];
      process.stdout.write(JSON.stringify({
        file: path.basename(resolved.filepath),
        extendsExpo: Object.prototype.hasOwnProperty.call(config.transformer, '_expoRelativeProjectRoot'),
        projectRootMatches: config.projectRoot === projectRoot,
        watchesWorkspace: config.watchFolders.includes(workspaceRoot),
        resolvesWorkspaceModules: config.resolver.nodeModulesPaths.includes(path.join(workspaceRoot, 'node_modules')),
        blocksNextOutput: rules.some(rule => rule.test(path.join(workspaceRoot, 'apps/web/.next/cache/file'))),
        blocksTemporaryOutput: rules.some(rule => rule.test(path.join(workspaceRoot, '.tmp/private/file'))),
      }));
    })().catch(error => { process.stderr.write(error.message); process.exitCode = 1; });
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      EAS_BUILD_PROFILE: 'production-store',
      EXPO_PUBLIC_API_BASE_URL: 'https://www.speedyvan.uk',
      EXPO_NO_TELEMETRY: '1',
    },
    timeout: 30_000,
  });
  const result: unknown = JSON.parse(output);
  expect(result).toEqual({
    file: 'metro.config.cjs', extendsExpo: true, projectRootMatches: true,
    watchesWorkspace: true, resolvesWorkspaceModules: true,
    blocksNextOutput: true, blocksTemporaryOutput: true,
  });
});
