// Build script: compiles TypeScript/React, runs electron-builder, patches EXE with icon+version
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const UNPACKED_DIR = path.join(ROOT, 'release', 'win-unpacked');
const EXE_PATH = path.join(UNPACKED_DIR, 'Trae Account Manager.exe');
const MAKE_DIST = process.argv.includes('--dist');

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
    return true;
  } catch (e) {
    return false;
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch (e) {
      // Sometimes files are locked; try again after a brief wait
      try {
        const { execSync } = require('child_process');
        execSync(`powershell -Command "Start-Sleep -Milliseconds 500; Remove-Item -Recurse -Force '${p}'"`, { stdio: 'pipe' });
      } catch {}
    }
  }
}

console.log('=== Trae Account Manager Build ===');
console.log(`Mode: ${MAKE_DIST ? 'Installer (NSIS)' : 'Portable (dir)'}`);

// Step 0: Clean old release
console.log('\n[0/4] Cleaning previous build...');
rmrf(UNPACKED_DIR);
if (MAKE_DIST) {
  // Also clean old installers
  const releaseDir = path.join(ROOT, 'release');
  if (fs.existsSync(releaseDir)) {
    fs.readdirSync(releaseDir).forEach(f => {
      if (f.endsWith('.exe') || f.endsWith('.blockmap') || f.endsWith('.yaml')) {
        try { fs.unlinkSync(path.join(releaseDir, f)); } catch {}
      }
    });
  }
}

// Step 1: Compile renderer + main + preload
console.log('\n[1/4] Building TypeScript & React...');
if (!run('npm run build')) {
  console.error('ERROR: Build failed!');
  process.exit(1);
}

// Step 2: Run electron-builder --dir (may fail at rcedit but files will be copied)
console.log('\n[2/4] Packaging with electron-builder (unpacked)...');
const packResult = run('npx electron-builder --dir --publish never');
if (!packResult) {
  console.log('\nNote: electron-builder reported an error (likely rcedit).');
  console.log('Continuing to apply icon/version patch...');
}

// Check if EXE exists
if (!fs.existsSync(EXE_PATH)) {
  console.error('ERROR: EXE not found at:', EXE_PATH);
  console.error('electron-builder may have failed before packaging.');
  process.exit(1);
}

// Step 3: Patch the EXE with icon and version info
console.log('\n[3/4] Applying icon and version info...');
if (!run('node scripts/patch-exe.js')) {
  console.error('ERROR: Patch failed!');
  process.exit(1);
}

// Step 4: If dist mode, create NSIS installer from the patched directory
if (MAKE_DIST) {
  console.log('\n[4/4] Creating NSIS installer...');
  // Use --prepackaged to point to our already-patched app
  const distResult = run(`npx electron-builder --prepackaged "${UNPACKED_DIR}" --publish never`);
  if (!distResult) {
    console.error('ERROR: Failed to create installer!');
    process.exit(1);
  }
  console.log('\n=== Installer Build Complete! ===');
  // List installer files
  const releaseDir = path.join(ROOT, 'release');
  fs.readdirSync(releaseDir).forEach(f => {
    if (f.endsWith('.exe')) {
      const fp = path.join(releaseDir, f);
      const stat = fs.statSync(fp);
      const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
      console.log(`  ${f} (${sizeMB} MB)`);
    }
  });
} else {
  console.log('\n=== Build Complete! ===');
}

console.log('');
console.log('Output directory:', UNPACKED_DIR);
console.log('Main EXE:', EXE_PATH);
console.log('');
