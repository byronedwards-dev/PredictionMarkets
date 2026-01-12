/**
 * Fix ALL Kalshi prices stored as cents (0-100) instead of probability (0-1)
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log('Fixing ALL Kalshi prices > 1...\n');

  // Fix yes_price
  const fixResult = await pool.query(`
    UPDATE price_snapshots ps
    SET 
      yes_price = ps.yes_price / 100,
      no_price = 1 - (ps.yes_price / 100),
      yes_bid = CASE WHEN ps.yes_bid > 1 THEN ps.yes_bid / 100 ELSE ps.yes_bid END,
      yes_ask = CASE WHEN ps.yes_ask > 1 THEN ps.yes_ask / 100 ELSE ps.yes_ask END,
      no_bid = CASE WHEN ps.no_bid > 1 THEN ps.no_bid / 100 ELSE ps.no_bid END,
      no_ask = CASE WHEN ps.no_ask > 1 THEN ps.no_ask / 100 ELSE ps.no_ask END
    FROM markets m
    WHERE ps.market_id = m.id 
      AND m.platform = 'kalshi' 
      AND ps.yes_price > 1
  `);
  
  console.log(`✅ Fixed ${fixResult.rowCount} price snapshots`);

  // Verify
  const verify = await pool.query(`
    SELECT COUNT(*) as count
    FROM price_snapshots ps
    JOIN markets m ON ps.market_id = m.id
    WHERE m.platform = 'kalshi' AND ps.yes_price > 1
  `);
  console.log(`Remaining bad prices: ${verify.rows[0].count}`);
  
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
