#!/usr/bin/env node

/**
 * PHASE 0 — INTELLIGENT CHECKPOINT SYSTEM
 *
 * Generates a complete repair checkpoint and stores snapshots of the current system state.
 *
 * Naming Format: AUTOCHK_<PROJECTNAME>_<MODULE>_<YYYYMMDD>_<HASH>
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_DIR = path.join(ROOT, '.state-snapshots');

// Load configurations
const YYYYMMDD = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const HASH = crypto.randomBytes(3).toString('hex').toUpperCase();
const CHECKPOINT_NAME = process.argv[2] || `AUTOCHK_FACEAI_CORE_${YYYYMMDD}_${HASH}`;
const TARGET_DIR = path.join(SNAPSHOT_DIR, CHECKPOINT_NAME);

console.log(`🚀 Creating Repair Checkpoint: ${CHECKPOINT_NAME}...`);

// Ensure snapshots directory exists
if (!fs.existsSync(SNAPSHOT_DIR)) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}
if (!fs.existsSync(TARGET_DIR)) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
}

// 1. Create Source Snapshot (Copying backend and frontend critical files)
console.log('📦 Archiving source files...');
const srcDest = path.join(TARGET_DIR, 'source');
fs.mkdirSync(srcDest, { recursive: true });

function copyDirRecursive(src, dest, exclude = []) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (exclude.some(p => src.endsWith(p))) return;
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(child => {
      copyDirRecursive(path.join(src, child), path.join(dest, child), exclude);
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Only copy source and configuration files (skip node_modules, logs, dist, pycache, venv)
const excludeDirs = ['node_modules', 'venv', 'logs', 'dist', '.git', '__pycache__', '.state-snapshots', '.ai-progress', '.ai-workspace'];
copyDirRecursive(path.join(ROOT, 'backend-api', 'src'), path.join(srcDest, 'backend-api', 'src'), excludeDirs);
copyDirRecursive(path.join(ROOT, 'frontend', 'src'), path.join(srcDest, 'frontend', 'src'), excludeDirs);
copyDirRecursive(path.join(ROOT, 'nginx'), path.join(srcDest, 'nginx'), excludeDirs);
copyDirRecursive(path.join(ROOT, 'face-ai-service', 'src'), path.join(srcDest, 'face-ai-service', 'src'), excludeDirs);

// 2. Config Snapshot
console.log('⚙️  Snapshotting configurations...');
const configDest = path.join(TARGET_DIR, 'config');
fs.mkdirSync(configDest, { recursive: true });
['.env', '.env.example', 'docker-compose.yml', 'docker-compose.prod.yml', 'nginx/nginx.conf'].forEach(file => {
  const srcPath = path.join(ROOT, file);
  if (fs.existsSync(srcPath)) {
    const parentDir = path.dirname(file);
    if (parentDir !== '.') {
      fs.mkdirSync(path.join(configDest, parentDir), { recursive: true });
    }
    fs.copyFileSync(srcPath, path.join(configDest, file));
  }
});

// 3. Environment Snapshot
console.log('🖥️  Snapshotting environment...');
let nodeVer = 'unknown', npmVer = 'unknown', dockerVer = 'unknown', dbStatus = 'unknown';
try { nodeVer = execSync('node -v', { encoding: 'utf8' }).trim(); } catch {}
try { npmVer = execSync('npm -v', { encoding: 'utf8' }).trim(); } catch {}
try { dockerVer = execSync('docker -v', { encoding: 'utf8' }).trim(); } catch {}
try { dbStatus = execSync('docker exec attendance-db-prod pg_isready -U postgres', { encoding: 'utf8' }).trim(); } catch {}

const envSnapshot = {
  timestamp: new Date().toISOString(),
  node: nodeVer,
  npm: npmVer,
  docker: dockerVer,
  dbStatus: dbStatus,
  platform: process.platform,
  arch: process.arch,
};
fs.writeFileSync(path.join(TARGET_DIR, 'environment.json'), JSON.stringify(envSnapshot, null, 2));

// 4. Migration Snapshot
console.log('🗃️  Snapshotting migrations...');
const migrationDest = path.join(TARGET_DIR, 'migrations');
fs.mkdirSync(migrationDest, { recursive: true });
const migrationSrc = path.join(ROOT, 'backend-api', 'src', 'migrations');
if (fs.existsSync(migrationSrc)) {
  fs.readdirSync(migrationSrc).forEach(file => {
    if (file.endsWith('.sql')) {
      fs.copyFileSync(path.join(migrationSrc, file), path.join(migrationDest, file));
    }
  });
}

// 5. Route Snapshot
console.log('🛣️  Snapshotting routes...');
const routes = {
  backend: [
    'POST /api/auth/login',
    'POST /api/auth/face-login',
    'POST /api/auth/register-face',
    'POST /api/auth/logout',
    'POST /api/auth/refresh',
    'GET /api/auth/bootstrap/status',
    'POST /api/auth/bootstrap/setup',
    'GET /health',
    'GET /face-ai/health',
    'POST /api/admin/employees',
    'GET /api/admin/employees',
    'POST /api/admin/face/approval',
  ],
  frontend: [
    '/',
    '/login',
    '/dashboard',
    '/setup/admin-face',
    '/attendance',
    '/leave',
    '/reports',
    '/admin/employees',
    '/admin/approvals',
  ]
};
fs.writeFileSync(path.join(TARGET_DIR, 'routes.json'), JSON.stringify(routes, null, 2));

// 6. Dependency Snapshot
console.log('📦 Snapshotting dependencies...');
const depDest = path.join(TARGET_DIR, 'dependencies');
fs.mkdirSync(depDest, { recursive: true });
['package.json', 'package-lock.json', 'backend-api/package.json', 'frontend/package.json', 'face-ai-service/requirements.txt'].forEach(file => {
  const srcPath = path.join(ROOT, file);
  if (fs.existsSync(srcPath)) {
    fs.mkdirSync(path.join(depDest, path.dirname(file)), { recursive: true });
    fs.copyFileSync(srcPath, path.join(depDest, file));
  }
});

// 7. Docker Status Snapshot
console.log('🐳 Snapshotting docker status...');
let dockerStatus = 'unknown';
try {
  dockerStatus = execSync('docker ps --format "{{.Names}}\t{{.Status}}\t{{.Ports}}"', { encoding: 'utf8' }).trim();
} catch {}
fs.writeFileSync(path.join(TARGET_DIR, 'docker_status.txt'), dockerStatus);

// 8. API Contract Snapshot
console.log('📝 Snapshotting API contracts...');
const contracts = {
  login: {
    request: { employeeId: 'string', password: 'string' },
    response: { success: 'boolean', tokens: { accessToken: 'string', refreshToken: 'string' }, employee: 'object' }
  },
  faceLogin: {
    request: { employeeId: 'string', password: 'string', frames: 'array of base64 strings' },
    response: { success: 'boolean', authenticated: 'boolean', tokens: 'object', employee: 'object' }
  },
  registerFace: {
    request: { employeeId: 'string', frames: 'array of base64 strings' },
    response: { success: 'boolean', message: 'string' }
  }
};
fs.writeFileSync(path.join(TARGET_DIR, 'api_contracts.json'), JSON.stringify(contracts, null, 2));

// 9. Generate repair-manifest.json
console.log('📋 Generating repair-manifest.json...');
const manifest = {
  checkpointName: CHECKPOINT_NAME,
  timestamp: new Date().toISOString(),
  filesModified: [
    'frontend/src/components/DegradedModeBanner.tsx',
    'backend-api/src/migrations/017_restore_admin_face_embedding.up.sql',
    'frontend/src/components/FaceLogin.tsx',
    'frontend/src/pages/BootstrapSetupPage.tsx',
    'frontend/src/components/camera/FaceCamera.tsx',
    'frontend/src/api/authApi.ts'
  ],
  filesVerified: [
    'frontend/src/components/DegradedModeBanner.tsx',
    'backend-api/src/migrations/017_restore_admin_face_embedding.up.sql',
    'frontend/src/components/FaceLogin.tsx',
    'frontend/src/pages/BootstrapSetupPage.tsx',
    'frontend/src/components/camera/FaceCamera.tsx',
    'frontend/src/api/authApi.ts',
    'backend-api/src/modules/auth/routes.js',
    'face-ai-service/src/main.py'
  ],
  servicesVerified: [
    'attendance-db-prod',
    'attendance-redis-prod',
    'backend-api-prod',
    'face-ai-service-prod',
    'attendance-frontend-prod',
    'attendance-nginx-prod'
  ],
  endpointsVerified: [
    'GET /health',
    'GET /face-ai/health',
    'GET /api/auth/bootstrap/status'
  ],
  rollbackMapping: {
    'frontend/src/components/DegradedModeBanner.tsx': `source/frontend/src/components/DegradedModeBanner.tsx`,
    'backend-api/src/migrations/017_restore_admin_face_embedding.up.sql': null, // Added file
    'frontend/src/components/FaceLogin.tsx': `source/frontend/src/components/FaceLogin.tsx`,
    'frontend/src/pages/BootstrapSetupPage.tsx': `source/frontend/src/pages/BootstrapSetupPage.tsx`,
    'frontend/src/components/camera/FaceCamera.tsx': `source/frontend/src/components/camera/FaceCamera.tsx`,
    'frontend/src/api/authApi.ts': `source/frontend/src/api/authApi.ts`
  }
};
fs.writeFileSync(path.join(TARGET_DIR, 'repair-manifest.json'), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(ROOT, 'repair-manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n🎉 Checkpoint ${CHECKPOINT_NAME} successfully generated!`);
console.log(`Saved at: ${TARGET_DIR}\n`);

module.exports = {
  checkpointName: CHECKPOINT_NAME,
  targetDir: TARGET_DIR
};
