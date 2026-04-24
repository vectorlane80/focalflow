'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function createWindowShim() {
  const shim = {};
  shim.window = shim;
  shim.setTimeout = setTimeout;
  shim.clearTimeout = clearTimeout;
  shim.setInterval = setInterval;
  shim.clearInterval = clearInterval;
  return shim;
}

function loadModule(relativePath, globalName, shim) {
  const windowShim = shim || createWindowShim();
  const absolutePath = path.resolve(projectRoot, relativePath);
  const source = fs.readFileSync(absolutePath, 'utf8');
  // Wrap the IIFE source in a function that injects `window` as the global.
  // The IIFE invokes itself with `window` at the bottom, so we replace that
  // symbol by providing a local binding via Function args.
  const factory = new Function('window', 'Node', source);
  factory(windowShim, { TEXT_NODE: 3, ELEMENT_NODE: 1 });

  if (globalName) {
    return windowShim[globalName];
  }

  return windowShim;
}

module.exports = { loadModule, createWindowShim };
