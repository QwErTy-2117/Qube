import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const rootDir = process.cwd();
const sidecarDistDir = path.join(rootDir, 'sidecar-dist');
const nextDir = path.join(rootDir, '.next');
const standaloneDir = path.join(nextDir, 'standalone');

console.log('Building Next.js standalone application...');
// Run Next.js build with TAURI_BUILD=true
try {
  execSync('npm run build', {
    stdio: 'inherit',
    env: { ...process.env, TAURI_BUILD: 'true' }
  });
} catch (error) {
  console.error('Next.js build failed:', error);
  process.exit(1);
}

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

// Helper to copy files/folders recursively
function copySync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
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
  // Copy server.js and package.json
  console.log('Copying standalone files...');
  copySync(path.join(standaloneDir, 'server.js'), path.join(sidecarDistDir, 'server.js'));
  copySync(path.join(standaloneDir, 'package.json'), path.join(sidecarDistDir, 'package.json'));

  // Copy standalone .next folder
  console.log('Copying standalone .next folder...');
  copySync(path.join(standaloneDir, '.next'), path.join(sidecarDistDir, '.next'));

  // Remove nested node_modules inside .next if they exist
  const nestedNodeModules = path.join(sidecarDistDir, '.next', 'node_modules');
  if (fs.existsSync(nestedNodeModules)) {
    fs.rmSync(nestedNodeModules, { recursive: true, force: true });
  }

  // Copy static assets
  console.log('Copying static assets...');
  copySync(path.join(nextDir, 'static'), path.join(sidecarDistDir, '.next', 'static'));

  // Copy standalone node_modules
  console.log('Copying standalone node_modules...');
  copySync(path.join(standaloneDir, 'node_modules'), path.join(sidecarDistDir, 'node_modules'));

  // Copy public folder if it exists
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
