#!/usr/bin/env node
/**
 * Run an Apps Script function remotely and print return value + recent logs.
 * Usage: node scripts/run-function.js [functionName]
 * Default: testGetPriceSample
 */
const { execSync } = require('child_process');

const fn = process.argv[2] || 'testGetPriceSample';
const clasp = 'npx clasp';

console.log(`\n▶ Running ${fn} on Google Apps Script...\n`);

try {
  const out = execSync(`${clasp} run ${fn} --json`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('Return value:');
  console.log(out.trim() || '(empty)');
} catch (err) {
  const msg = err.stdout || err.stderr || err.message;
  console.error(msg);
  if (!String(msg).includes('Script function not found')) {
    process.exitCode = 1;
  }
}

console.log('\n--- Recent execution logs ---\n');
try {
  execSync(`${clasp} logs --json`, { encoding: 'utf8', stdio: 'inherit' });
} catch {
  try {
    execSync(`${clasp} logs`, { encoding: 'utf8', stdio: 'inherit' });
  } catch (e) {
    console.error('Could not fetch logs. Run: npm run logs');
  }
}
