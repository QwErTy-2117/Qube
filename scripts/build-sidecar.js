import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

const rootDir = process.cwd();
const sidecarDistDir = path.join(rootDir, 'sidecar-dist');
const nextDir = path.join(rootDir, '.next');
const standaloneDir = path.join(nextDir, 'standalone');

// Platform diagnostics
console.log('=== Build Environment ===');
console.log(`Platform: ${os.platform()}`);
console.log(`Release: ${os.release()}`);
console.log(`Node.js: ${process.version}`);
console.log(`Arch: ${os.arch()}`);
console.log(`CWD: ${rootDir}`);
console.log(`TAURI_BUILD: ${process.env.TAURI_BUILD || 'not set'}`);

if (os.platform() === 'win32') {
  console.log('=== Windows Junction Check ===');
  const appData = 'C:\\Users\\runneradmin\\Application Data';
  try {
    const stat = fs.lstatSync(appData);
    console.log(`Application Data exists: ${stat.isDirectory()}, isSymbolicLink: ${stat.isSymbolicLink()}`);
  } catch (e) {
    console.log(`Application Data check skipped: ${e.message}`);
  }
  // Check for problematic junctions in common paths
  for (const p of ['C:\\Users', rootDir]) {
    try {
      const entries = fs.readdirSync(p, { withFileTypes: true });
      const junctions = entries.filter(e => e.isSymbolicLink?.() || false);
      if (junctions.length > 0) {
        console.log(`Junctions in ${p}: ${junctions.map(e => e.name).join(', ')}`);
      } else {
        console.log(`No junctions in ${p}`);
      }
    } catch (e) {
      console.log(`Could not scan ${p}: ${e.message}`);
    }
  }
}

console.log('=== Starting Next.js Build ===');
try {
  execSync('npm run build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_BUILD: 'true',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --stack-trace-limit=100`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
} catch (error) {
  console.error('\n=== NEXT.JS BUILD FAILED ===');
  console.error(`Error name: ${error.name}`);
  console.error(`Error message: ${error.message}`);
  console.error(`Exit code: ${error.status}`);
  if (error.stderr) console.error(`Stderr: ${error.stderr}`);
  if (error.stdout) console.error(`Stdout: ${error.stdout}`);
  if (error.stack) console.error(`Stack: ${error.stack}`);
  process.exit(1);
}

// Post-build: create aliases for Turbopack's auto-externalized modules
function createExternalAliases() {
  console.log('=== Creating External Module Aliases ===');
  const externalsDir = path.join(standaloneDir, 'node_modules');
  const hashedNames = new Set();
  function walkDir(dir) {
    if (!fs.existsSync(dir)) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walkDir(fullPath);
        else if (entry.name.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const match = content.match(/[a-z0-9_@/-]+-[a-f0-9]{16}/gi);
          if (match) match.forEach(m => hashedNames.add(m));
        }
      }
    } catch { /* skip unreadable */ }
  }
  walkDir(nextDir);
  if (hashedNames.size === 0) {
    console.log('No external module aliases needed.');
    return;
  }
  for (const name of hashedNames) {
    const modDir = path.join(externalsDir, name);
    if (fs.existsSync(modDir)) {
      console.log(`  Alias already exists: ${name}`);
      continue;
    }
    const realPackage = name.replace(/-[a-f0-9]{16}$/, '');
    console.log(`  Creating alias: ${name} -> ${realPackage}`);
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
    fs.writeFileSync(path.join(modDir, 'index.js'), `module.exports = require("${realPackage}");\n`);
  }
}
createExternalAliases();

console.log('Preparing sidecar-dist directory...');
try {
  if (fs.existsSync(sidecarDistDir)) {
    fs.rmSync(sidecarDistDir, { recursive: true, force: true });
  }
  fs.mkdirSync(sidecarDistDir, { recursive: true });
} catch (error) {
  console.error('Failed to prepare sidecar-dist directory:', error);
  process.exit(1);
}

function copySync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    const resolved = fs.realpathSync(src);
    console.log(`  Following symlink: ${src} -> ${resolved}`);
    copySync(resolved, dest);
    return;
  }
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((file) => {
      copySync(path.join(src, file), path.join(dest, file));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

try {
  console.log('Copying standalone files...');
  copySync(path.join(standaloneDir, 'server.js'), path.join(sidecarDistDir, 'server.js'));
  copySync(path.join(standaloneDir, 'package.json'), path.join(sidecarDistDir, 'package.json'));

  console.log('Copying standalone .next folder...');
  copySync(path.join(standaloneDir, '.next'), path.join(sidecarDistDir, '.next'));

  const nestedNodeModules = path.join(sidecarDistDir, '.next', 'node_modules');
  if (fs.existsSync(nestedNodeModules)) {
    fs.rmSync(nestedNodeModules, { recursive: true, force: true });
  }

  console.log('Copying static assets...');
  copySync(path.join(nextDir, 'static'), path.join(sidecarDistDir, '.next', 'static'));

  console.log('Copying standalone node_modules...');
  copySync(path.join(standaloneDir, 'node_modules'), path.join(sidecarDistDir, 'node_modules'));

  const publicSrc = path.join(standaloneDir, 'public');
  if (fs.existsSync(publicSrc)) {
    console.log('Copying public directory...');
    copySync(publicSrc, path.join(sidecarDistDir, 'public'));
  }

  console.log('Sidecar distribution prepared successfully!');
} catch (error) {
  console.error('Failed to package sidecar:', error);
  process.exit(1);
}
