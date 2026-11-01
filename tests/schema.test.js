import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const schemaPath = path.resolve(projectRoot, 'tgcloud/schema.js');
const tgcloudDir = path.resolve(projectRoot, 'tgcloud');

function getAllJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllJsFiles(fullPath));
    } else if (file.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

test('schema: no unterminated or corrupted string artifacts', () => {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');

  // a) No corrupted text('... literal artifacts
  assert.equal(schemaContent.includes("text('..."), false, "schema.js contains corrupted literal text('...");
  assert.equal(schemaContent.includes("text('.."), false, "schema.js contains corrupted literal text('..");
  assert.equal(schemaContent.includes("...l()"), false, "schema.js contains corrupted literal ...l()");

  // Specifically check apiKey in aiKeys
  assert.match(schemaContent, /apiKey:\s+text\('api_key'\)\.notNull\(\)/, "aiKeys table must have apiKey: text('api_key').notNull()");
});

test('schema: all referenced fields in tgcloud/ exist in table definitions', () => {
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');

  // Extract fields defined in each table
  const tableNames = ['users', 'sources', 'customProviders', 'aiKeys', 'tokenUsage', 'posts'];
  const definedFields = {};

  for (const tName of tableNames) {
    definedFields[tName] = new Set();
    // Match export const <tName> = table('<sql_name>', { ... })
    const tableRegex = new RegExp(`export const ${tName} = table\\('[^']+',\\s*\\{([\\s\\S]*?)\\}\\s*,`, 'm');
    const match = schemaContent.match(tableRegex);
    assert.ok(match, `Table ${tName} definition found in schema.js`);

    const body = match[1];
    // Find all field keys: <fieldName>: (integer|text|boolean)\(
    const fieldRegex = /^\s*([a-zA-Z0-9_]+):\s*(?:integer|text|boolean)\(/gm;
    let fMatch;
    while ((fMatch = fieldRegex.exec(body)) !== null) {
      definedFields[tName].add(fMatch[1]);
    }
    assert.ok(definedFields[tName].size > 0, `Table ${tName} has defined fields`);
  }

  // Verify critical fields exist on aiKeys explicitly
  const criticalAiKeysFields = [
    'apiKey', 'label', 'baseUrl', 'status', 'failureCount',
    'cooldownUntil', 'sortOrder', 'totalTokens', 'lastUsedAt', 'createdAt'
  ];
  for (const f of criticalAiKeysFields) {
    assert.ok(definedFields.aiKeys.has(f), `aiKeys must define field: ${f}`);
  }

  // Scan all tgcloud/ JS files for <tableName>.<fieldName>
  const jsBuiltins = new Set(['length', 'map', 'filter', 'find', 'forEach', 'includes', 'slice', 'some', 'every', 'reduce', 'push']);
  const jsFiles = getAllJsFiles(tgcloudDir);

  for (const file of jsFiles) {
    const code = fs.readFileSync(file, 'utf8');
    for (const tName of tableNames) {
      // Only check if the file actually imports tName from schema
      const importRegex = new RegExp(`\\bimport\\s*\\{[^}]*\\b${tName}\\b[^}]*\\}\\s*from\\s*['"]schema['"]`);
      if (!importRegex.test(code)) continue;

      const refRegex = new RegExp(`(?<![\\.\\w])${tName}\\.([a-zA-Z0-9_]+)\\b`, 'g');
      let rMatch;
      while ((rMatch = refRegex.exec(code)) !== null) {
        const fieldRef = rMatch[1];
        if (fieldRef.startsWith('_')) continue;
        if (jsBuiltins.has(fieldRef)) continue;

        assert.ok(
          definedFields[tName].has(fieldRef),
          `Referenced field ${tName}.${fieldRef} in ${path.basename(file)} must exist in schema.js`
        );
      }
    }
  }
});
