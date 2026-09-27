#!/usr/bin/env node
/**
 * enable-desktop-mic.cjs
 * 
 * DeepSeek Harness Desktop (Electron) blocks microphone/media access by default
 * because its Electron main process hardcodes a whitelist that excludes "media".
 * 
 * This script patches DSH Desktop's app.asar to allow media (microphone) permission,
 * enabling voice recording natively inside the desktop app.
 */

const fs = require('fs');
const path = require('path');

const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Local');
const defaultAsarPath = path.join(localAppData, 'Programs', 'DSH Desktop', 'resources', 'app.asar');

const targetPath = process.argv[2] || defaultAsarPath;

console.log('=== DeepSeek Harness Desktop Microphone Enabler ===');
console.log(`Target app.asar: ${targetPath}`);

if (!fs.existsSync(targetPath)) {
  console.error(`\n[ERROR] app.asar not found at: ${targetPath}`);
  console.error('If DSH Desktop is installed in a custom path, pass it as an argument:');
  console.error('  node enable-desktop-mic.cjs "C:\\path\\to\\app.asar"');
  process.exit(1);
}

// 1. Create a backup
const backupPath = targetPath + '.bak';
if (!fs.existsSync(backupPath)) {
  console.log(`Creating backup: ${backupPath}`);
  fs.copyFileSync(targetPath, backupPath);
} else {
  console.log(`Backup already exists: ${backupPath}`);
}

// 2. Read the asar archive
const buf = fs.readFileSync(targetPath);

const oldPattern = Buffer.from('(permission === "clipboard-sanitized-write" || permission === "notifications")');
const idx = buf.indexOf(oldPattern);

if (idx === -1) {
  // Check if it's already patched
  const patchedPattern = Buffer.from('/^(clipboard-sanitized-write|notifications|media)$/');
  if (buf.indexOf(patchedPattern) !== -1) {
    console.log('\n[SUCCESS] app.asar is already patched for media/microphone access!');
    console.log('Ensure you have restarted DSH Desktop and enabled microphone in Windows Settings.');
    process.exit(0);
  }
  console.error('\n[ERROR] Target permission pattern not found in app.asar.');
  console.error('Your version of DSH Desktop may have a different permission implementation.');
  process.exit(1);
}

// 3. Build exact byte-for-byte replacement (must match exactly 78 bytes)
const baseReplacement = '(/^(clipboard-sanitized-write|notifications|media)$/.test(permission))';
const replacementStr = baseReplacement.padEnd(oldPattern.length, ' ');
const replacementBuf = Buffer.from(replacementStr);

if (replacementBuf.length !== oldPattern.length) {
  console.error('\n[ERROR] Byte length mismatch during patch construction.');
  process.exit(1);
}

// 4. Apply patch in-place
replacementBuf.copy(buf, idx);

try {
  fs.writeFileSync(targetPath, buf);
  console.log('\n[SUCCESS] Successfully patched app.asar!');
  console.log('\nNext steps:');
  console.log('1. Make sure "Let desktop apps access your microphone" is ON in Windows:');
  console.log('   Settings -> Privacy & security -> Microphone');
  console.log('2. Completely close and restart DSH Desktop.');
  console.log('3. Enjoy voice input directly in the desktop app!');
} catch (err) {
  console.error(`\n[ERROR] Failed to write patched app.asar: ${err.message}`);
  console.error('Make sure DSH Desktop is closed before running this script.');
  process.exit(1);
}
