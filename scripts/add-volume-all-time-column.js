/**
 * Migration script to add volume_all_time column to price_snapshots table
 * Run with: node scripts/add-volume-all-time-column.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env.local if it exists
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
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/prediction_markets';

const pool = new Pool({
  connectionString: DATABASE_URL,
});

async function addVolumeAllTimeColumn() {
  console.log('🚀 Adding volume_all_time column to price_snapshots table...');
  console.log(`📍 Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  
  const client = await pool.connect();
  
  try {
    // Check if column already exists
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'price_snapshots' 
        AND column_name = 'volume_all_time'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ Column volume_all_time already exists');
      return;
    }
    
    // Add the column
    console.log('📝 Adding volume_all_time column...');
    await client.query(`
      ALTER TABLE price_snapshots 
      ADD COLUMN volume_all_time DECIMAL(20, 2)
    `);
    
    console.log('✅ Column added successfully');
    
    // Verify
    const verifyResult = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'price_snapshots' 
        AND column_name = 'volume_all_time'
    `);
    
    if (verifyResult.rows.length > 0) {
      console.log(`✅ Verified: ${verifyResult.rows[0].column_name} (${verifyResult.rows[0].data_type})`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

addVolumeAllTimeColumn().catch((err) => {
  console.error(err);
  process.exit(1);
});
