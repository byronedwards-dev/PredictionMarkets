/**
 * Debug script to check volume data in database
 * Run with: npx ts-node scripts/check-volumes.ts
 */

import { query } from '../src/lib/db';

async function checkVolumes() {
  console.log('Checking volume data...\n');

  // Find markets with high 24h volume but 0 all-time
  const result = await query<{
    id: number;
    platform: string;
    title: string;
    volume_24h: string;
    volume_all_time: string;
    snapshot_at: string;
  }>(`
    SELECT m.id, m.platform, m.title, 
           ps.volume_24h, ps.volume_all_time, ps.snapshot_at
    FROM markets m
    JOIN LATERAL (
      SELECT volume_24h, volume_all_time, snapshot_at
      FROM price_snapshots 
      WHERE market_id = m.id 
      ORDER BY snapshot_at DESC 
      LIMIT 1
    ) ps ON true
    WHERE ps.volume_24h > 100000  -- Markets with >$100k 24h volume
    ORDER BY ps.volume_24h DESC
    LIMIT 20
  `);

  console.log('High 24h volume markets:\n');
  console.log('ID\t\tPlatform\t24h Vol\t\tAll-Time\tTitle');
  console.log('-'.repeat(100));
  
  for (const row of result.rows) {
    const vol24h = parseFloat(row.volume_24h);
    const volAllTime = parseFloat(row.volume_all_time);
    const mismatch = vol24h > 0 && volAllTime === 0 ? '⚠️' : '✓';
    
    console.log(
      `${row.id}\t\t${row.platform}\t\t$${(vol24h/1000000).toFixed(1)}M\t\t$${volAllTime > 0 ? (volAllTime/1000000).toFixed(1)+'M' : '0'}\t\t${mismatch} ${row.title.substring(0, 40)}...`
    );
  }

  // Check if volume_all_time is consistently 0 for polymarket
  const zeroVolResult = await query<{ count: string }>(`
    SELECT COUNT(*) as count
    FROM price_snapshots
    WHERE volume_all_time = 0 AND volume_24h > 10000
  `);
  
  console.log(`\n\nSnapshots with 0 all-time but >$10k 24h: ${zeroVolResult.rows[0].count}`);

  // Sample a few to see actual values
  const sampleResult = await query<{
    market_id: number;
    volume_24h: string;
    volume_all_time: string;
  }>(`
    SELECT market_id, volume_24h, volume_all_time
    FROM price_snapshots
    WHERE volume_24h > 100000
    ORDER BY snapshot_at DESC
    LIMIT 5
  `);

  console.log('\nSample raw values:');
  for (const row of sampleResult.rows) {
    console.log(`  Market ${row.market_id}: 24h=${row.volume_24h}, all_time=${row.volume_all_time}`);
  }

  process.exit(0);
}

checkVolumes().catch(console.error);
