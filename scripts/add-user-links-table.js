/**
 * Migration: Add user_market_links table
 * 
 * Run with: node scripts/add-user-links-table.js
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

const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const migration = `
-- ===========================================
-- USER MARKET LINKS (for election matching)
-- ===========================================

CREATE TABLE IF NOT EXISTS user_market_links (
    id SERIAL PRIMARY KEY,
    poly_market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    kalshi_market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL DEFAULT 'elections',
    
    -- Matching metadata
    match_score DECIMAL(5, 2),           -- Fuzzy match confidence (0-100)
    poly_title TEXT,                      -- Cached for display
    kalshi_title TEXT,                    -- Cached for display
    
    -- Status: 'suggested', 'confirmed', 'rejected'
    status VARCHAR(20) NOT NULL DEFAULT 'suggested',
    
    -- Timestamps
    suggested_at TIMESTAMP DEFAULT NOW(),
    confirmed_at TIMESTAMP,
    rejected_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(poly_market_id, kalshi_market_id)
);

CREATE INDEX IF NOT EXISTS idx_user_market_links_status ON user_market_links(status);
CREATE INDEX IF NOT EXISTS idx_user_market_links_category ON user_market_links(category);
CREATE INDEX IF NOT EXISTS idx_user_market_links_score ON user_market_links(match_score DESC);
`;

async function migrate() {
  console.log('🚀 Adding user_market_links table...');
  
  const client = await pool.connect();
  
  try {
    await client.query(migration);
    console.log('✅ user_market_links table created successfully');
    
    // Verify
    const check = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_market_links'
      ORDER BY ordinal_position
    `);
    
    console.log('\n📊 Table columns:');
    check.rows.forEach(row => {
      console.log(`   - ${row.column_name}: ${row.data_type}`);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
