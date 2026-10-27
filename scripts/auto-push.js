const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const DEBOUNCE_MS = 6000; // wait 6 seconds after last change before pushing
let timeoutId = null;
let isPushing = false;
let pendingChanges = false;

const IGNORED_DIRS = ['.git', 'node_modules', '.gemini', '.system_generated', 'scratch'];

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: ROOT_DIR }, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function checkAndPush() {
  if (isPushing) {
    pendingChanges = true;
    return;
  }

  try {
    isPushing = true;
    // Check if there are any working tree changes
    const { stdout: status } = await runCommand('git status --porcelain');
    if (!status) {
      isPushing = false;
      return;
    }

    const now = new Date().toLocaleString();
    console.log(`\n⚡ [${now}] File changes detected. Auto-pushing to GitHub...`);

    await runCommand('git add .');
    const commitMsg = `Auto-sync: update ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`;
    await runCommand(`git commit -m "${commitMsg}"`);
    console.log(`📦 Committed changes.`);

    const { stdout: pushOut } = await runCommand('git push origin main');
    console.log(`🚀 Successfully pushed to GitHub: ${pushOut || 'main -> main'}`);
  } catch (error) {
    console.error('⚠️ Auto-push notice:', error?.stderr || error?.message || error);
  } finally {
    isPushing = false;
    if (pendingChanges) {
      pendingChanges = false;
      setTimeout(checkAndPush, 2000);
    }
  }
}

function schedulePush(filePath) {
  if (IGNORED_DIRS.some(dir => filePath.includes(dir))) return;
  console.log(`📝 Modified: ${path.relative(ROOT_DIR, filePath)}`);
  
  if (timeoutId) clearTimeout(timeoutId);
  timeoutId = setTimeout(() => {
    checkAndPush();
  }, DEBOUNCE_MS);
}

// Watch directory recursively
console.log('====================================================');
console.log('🤖 Turbo Tap Game - GitHub Automatic Push System');
console.log('Watching for file modifications in the project...');
console.log(`Auto-push will trigger ${DEBOUNCE_MS / 1000}s after any file is saved.`);
console.log('Press Ctrl + C to stop.');
console.log('====================================================\n');

try {
  fs.watch(ROOT_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    const fullPath = path.join(ROOT_DIR, filename);
    schedulePush(fullPath);
  });
} catch (e) {
  console.error('Watch error:', e);
}
