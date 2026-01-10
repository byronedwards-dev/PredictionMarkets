const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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
}

const DATABASE_URL = process.env.DATABASE_URL;
console.log('Connecting to:', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));

const pool = new Pool({ connectionString: DATABASE_URL });

async function fix() {
  const client = await pool.connect();
  try {
    console.log('Fixing column types...');
    
    // Make token columns TEXT (unlimited)
    await client.query('ALTER TABLE markets ALTER COLUMN token_id_a TYPE TEXT');
    await client.query('ALTER TABLE markets ALTER COLUMN token_id_b TYPE TEXT');
    await client.query('ALTER TABLE markets ALTER COLUMN outcome TYPE TEXT');
    
    console.log('✅ Columns fixed to TEXT type');
    
    // Check current state
    const result = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(token_id_a) as with_tokens,
        COUNT(CASE WHEN platform = 'polymarket' THEN 1 END) as polymarket,
        COUNT(CASE WHEN platform = 'kalshi' THEN 1 END) as kalshi
      FROM markets
    `);
    
    console.log('📊 Current state:');
    console.log('   Total markets:', result.rows[0].total);
    console.log('   With token IDs:', result.rows[0].with_tokens);
    console.log('   Polymarket:', result.rows[0].polymarket);
    console.log('   Kalshi:', result.rows[0].kalshi);
    
  } finally {
    client.release();
    await pool.end();
  }
}

fix().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
