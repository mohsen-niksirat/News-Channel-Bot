import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'sdk') {
    return {
      format: 'module',
      url: pathToFileURL(path.resolve(projectRoot, 'tests/mocks/sdk.js')).href,
      shortCircuit: true,
    };
  }

  if (specifier === 'sdk/db') {
    return {
      format: 'module',
      url: pathToFileURL(path.resolve(projectRoot, 'tests/mocks/sdk_db.js')).href,
      shortCircuit: true,
    };
  }

  if (specifier === 'schema') {
    return {
      format: 'module',
      url: pathToFileURL(path.resolve(projectRoot, 'tgcloud/schema.js')).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('lib/')) {
    const ext = specifier.endsWith('.js') ? '' : '.js';
    return {
      format: 'module',
      url: pathToFileURL(path.resolve(projectRoot, 'tgcloud', specifier + ext)).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('handlers/')) {
    const ext = specifier.endsWith('.js') ? '' : '.js';
    return {
      format: 'module',
      url: pathToFileURL(path.resolve(projectRoot, 'tgcloud', specifier + ext)).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith('endpoints/')) {
    const ext = specifier.endsWith('.js') ? '' : '.js';
    return {
      format: 'module',
      url: pathToFileURL(path.resolve(projectRoot, 'tgcloud', specifier + ext)).href,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
