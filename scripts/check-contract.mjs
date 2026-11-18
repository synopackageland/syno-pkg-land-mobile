import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const contract = JSON.parse(readFileSync('spec/native/v1/contract.json', 'utf8'));
const generated = readFileSync('src/core/bridge/contract.gen.ts', 'utf8');
const start = generated.indexOf('const schema = ') + 'const schema = '.length;
const end = generated.indexOf(' as Record<string, Rule>', start);
assert.deepEqual(JSON.parse(generated.slice(start, end)), contract.$defs, 'Local generated types drifted from the contract');
assert.equal(contract.protocol, 1);
console.log('Native contract mirror matches generated validator schema');
