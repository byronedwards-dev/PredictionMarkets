/**
 * Wrapper to run the sync job with .env.local loaded
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  console.log('✅ Loaded .env.local');
}

console.log(`📍 DATABASE_URL: ${(process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':****@')}`);
console.log(`📍 DOME_API_KEY: ${process.env.DOME_API_KEY ? '****' + process.env.DOME_API_KEY.slice(-4) : 'NOT SET'}`);

// Run the sync job
const child = spawn('npx', ['tsx', 'src/jobs/sync-markets.ts'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
  cwd: path.join(__dirname, '..'),
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
