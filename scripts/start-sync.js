#!/usr/bin/env node
/**
 * PM2 Sync Starter Script
 * 
 * This script is used by PM2 to run the sync job.
 * It dynamically imports the TypeScript sync job using tsx.
 */

const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const syncScript = path.join(projectRoot, 'src', 'jobs', 'sync-markets.ts');

console.log('🚀 Starting sync job via PM2...');
console.log(`   Script: ${syncScript}`);

// Use tsx to run the TypeScript file
const tsx = spawn('npx', ['tsx', syncScript], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    // Environment is set in ecosystem.config.js
  },
});

tsx.on('error', (error) => {
  console.error('Failed to start sync job:', error);
  process.exit(1);
});

tsx.on('close', (code) => {
  console.log(`Sync job exited with code ${code}`);
  process.exit(code);
});
