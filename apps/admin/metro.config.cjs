// EAS loads this with Node; .cjs preserves CommonJS inside this ESM workspace.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
// The shared workspace also contains Next build output, which Metro must not crawl.
config.resolver.blockList = [
  ...config.resolver.blockList,
  /(?:^|[\\/])\.next(?:[\\/]|$)/,
  /(?:^|[\\/])\.tmp(?:[\\/]|$)/
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules')
];

module.exports = config;
