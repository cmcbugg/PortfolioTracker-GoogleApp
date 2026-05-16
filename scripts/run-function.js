#!/usr/bin/env node
/**
 * Run an Apps Script function remotely and print return value + recent logs.
 * Usage: node scripts/run-function.js [functionName]
 * Default: testGetPriceSample
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const fn = process.argv[2] || 'testGetPriceSample';
const clasp = 'npx clasp';
const claspJsonPath = path.join(__dirname, '..', '.clasp.json');

if (fs.existsSync(claspJsonPath)) {
  const config = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
  if (!config.scriptId || config.scriptId === 'YOUR_APPS_SCRIPT_ID') {
    console.error(
      'Error: Set your Script ID in .clasp.json (copy .clasp.json.example).\n' +
        'Find it in Apps Script → Project settings → Script ID.'
    );
    process.exit(1);
  }
  if (config.projectId && config.projectId.length > 40) {
    console.warn(
      'Warning: .clasp.json "projectId" looks like a Script ID, not a GCP project ID.\n' +
        'Remove "projectId" from .clasp.json, then run: npx clasp logs --setup\n' +
        'Use the GCP Project ID from Apps Script → Project settings → Google Cloud Platform.\n'
    );
  }
} else {
  console.error('Error: Missing .clasp.json. Run: cp .clasp.json.example .clasp.json');
  process.exit(1);
}

console.log(`\n▶ Running ${fn} on Google Apps Script...\n`);

try {
  const out = execSync(`${clasp} run ${fn}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  console.log('Return value:');
  console.log(out.trim() || '(empty)');
} catch (err) {
  const msg = [err.stdout, err.stderr, err.message].filter(Boolean).join('\n');
  console.error(msg);
  if (msg.includes('Script function not found')) {
    console.error('\nTip: Run "npm run push" first so test functions exist in Apps Script.');
  }
  if (msg.includes('Unable to run') || msg.includes('Execution API')) {
    console.error(
      '\nTip: Enable the Apps Script API and ensure appsscript.json has executionApi access.\n' +
        '     https://script.google.com/home/usersettings'
    );
  }
  process.exitCode = 1;
}

console.log('\n--- Recent execution logs ---\n');
try {
  execSync(`${clasp} logs --json`, { encoding: 'utf8', stdio: 'inherit' });
} catch {
  try {
    execSync(`${clasp} logs`, { encoding: 'utf8', stdio: 'inherit' });
  } catch {
    console.error(
      'Could not fetch logs. Set up StackDriver logging:\n' +
        '  1. Remove "projectId" from .clasp.json if it is wrong\n' +
        '  2. Run: npx clasp logs --setup\n' +
        '  3. Use GCP Project ID from Apps Script → Project settings (not Script ID)'
    );
  }
}
