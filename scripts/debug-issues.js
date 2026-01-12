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
  console.log('=== ISSUE 1: Check confirmed link prices ===\n');
  const links = await pool.query(`
    SELECT uml.poly_title, uml.kalshi_title, 
           pps.yes_price as poly_price, kps.yes_price as kalshi_price
    FROM user_market_links uml
    LEFT JOIN LATERAL (
      SELECT yes_price FROM price_snapshots 
      WHERE market_id = uml.poly_market_id ORDER BY snapshot_at DESC LIMIT 1
    ) pps ON true
    LEFT JOIN LATERAL (
      SELECT yes_price FROM price_snapshots 
      WHERE market_id = uml.kalshi_market_id ORDER BY snapshot_at DESC LIMIT 1
    ) kps ON true
    WHERE uml.status = 'confirmed'
    LIMIT 5
  `);
  
  links.rows.forEach(row => {
    const polyPrice = parseFloat(row.poly_price || 0);
    const kalshiPrice = parseFloat(row.kalshi_price || 0);
    const diff = Math.abs(polyPrice - kalshiPrice) * 100;
    console.log(`${row.poly_title?.substring(0, 40)}...`);
    console.log(`  Poly: ${polyPrice} (${(polyPrice * 100).toFixed(1)}¢)`);
    console.log(`  Kalshi: ${kalshiPrice} (${(kalshiPrice * 100).toFixed(1)}¢)`);
    console.log(`  Diff calc: |${polyPrice} - ${kalshiPrice}| * 100 = ${diff.toFixed(1)}¢`);
    console.log(`  Kalshi > 1? ${kalshiPrice > 1 ? 'YES - NOT NORMALIZED!' : 'No'}`);
    console.log();
  });

  console.log('\n=== ISSUE 2: Check market_pairs table ===\n');
  const pairs = await pool.query(`SELECT COUNT(*) as count FROM market_pairs`);
  console.log(`Total pairs in market_pairs table: ${pairs.rows[0].count}`);
  
  const activePairs = await pool.query(`
    SELECT COUNT(*) as count FROM market_pairs mp
    JOIN markets pm ON mp.poly_market_id = pm.id
    JOIN markets km ON mp.kalshi_market_id = km.id
    WHERE pm.status = 'open' AND km.status = 'open'
  `);
  console.log(`Active pairs (both open): ${activePairs.rows[0].count}`);

  // Check sample pairs with their prices
  const samplePairs = await pool.query(`
    SELECT mp.id, pm.title as poly, km.title as kalshi, 
           pm.status as poly_status, km.status as kalshi_status,
           pps.yes_price as pp, kps.yes_price as kp
    FROM market_pairs mp
    JOIN markets pm ON mp.poly_market_id = pm.id
    JOIN markets km ON mp.kalshi_market_id = km.id
    LEFT JOIN LATERAL (
      SELECT yes_price FROM price_snapshots WHERE market_id = pm.id ORDER BY snapshot_at DESC LIMIT 1
    ) pps ON true
    LEFT JOIN LATERAL (
      SELECT yes_price FROM price_snapshots WHERE market_id = km.id ORDER BY snapshot_at DESC LIMIT 1
    ) kps ON true
    LIMIT 5
  `);
  console.log('\nSample pairs:');
  samplePairs.rows.forEach(row => {
    console.log(`  ${row.poly?.substring(0, 35)}...`);
    console.log(`    poly_status: ${row.poly_status}, kalshi_status: ${row.kalshi_status}`);
    console.log(`    poly_price: ${row.pp}, kalshi_price: ${row.kp}`);
    const passesFilter = (row.pp === null || (parseFloat(row.pp) > 0.02 && parseFloat(row.pp) < 0.98)) &&
                         (row.kp === null || (parseFloat(row.kp) > 0.02 && parseFloat(row.kp) < 0.98));
    console.log(`    Passes price filter (0.02-0.98)? ${passesFilter ? 'YES' : 'NO'}`);
  });

  console.log('\n=== ISSUE 3: Check volume_all_time in snapshots ===\n');
  const volCheck = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(volume_all_time) as has_all_time,
      COUNT(CASE WHEN volume_all_time > 0 THEN 1 END) as has_positive_all_time
    FROM price_snapshots
  `);
  console.log(`Total snapshots: ${volCheck.rows[0].total}`);
  console.log(`With volume_all_time: ${volCheck.rows[0].has_all_time}`);
  console.log(`With volume_all_time > 0: ${volCheck.rows[0].has_positive_all_time}`);

  // Check latest snapshots per market
  const latestVolCheck = await pool.query(`
    SELECT m.platform,
           COUNT(*) as market_count,
           COUNT(ps.volume_all_time) as has_vol,
           COUNT(CASE WHEN ps.volume_all_time > 0 THEN 1 END) as has_positive_vol
    FROM markets m
    LEFT JOIN LATERAL (
      SELECT volume_all_time FROM price_snapshots 
      WHERE market_id = m.id ORDER BY snapshot_at DESC LIMIT 1
    ) ps ON true
    WHERE m.status = 'open'
    GROUP BY m.platform
  `);
  console.log('\nLatest snapshot per market (open only):');
  latestVolCheck.rows.forEach(row => {
    console.log(`  ${row.platform}: ${row.market_count} markets, ${row.has_positive_vol} with volume_all_time > 0`);
  });

  // Check if any Kalshi prices are still > 1
  console.log('\n=== Check for remaining bad Kalshi prices ===\n');
  const badPrices = await pool.query(`
    SELECT COUNT(*) as count
    FROM price_snapshots ps
    JOIN markets m ON ps.market_id = m.id
    WHERE m.platform = 'kalshi' AND ps.yes_price > 1
  `);
  console.log(`Kalshi snapshots with yes_price > 1: ${badPrices.rows[0].count}`);

  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
