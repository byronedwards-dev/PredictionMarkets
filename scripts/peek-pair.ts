import { query } from '../src/lib/db';

async function run() {
  const pairs = await query(
    `SELECT mp.id, pm.platform_id as poly_id, km.platform_id as kalshi_id
     FROM market_pairs mp
     JOIN markets pm ON mp.poly_market_id = pm.id
     JOIN markets km ON mp.kalshi_market_id = km.id
     LIMIT 3`
  );
  console.log('Pairs:', pairs.rows);
  if (pairs.rows.length === 0) return;
  const p = pairs.rows[0];
  const snaps = await query(
    `SELECT m.platform, m.platform_id, ps.yes_bid, ps.no_bid, ps.yes_price, ps.no_price, ps.snapshot_at
     FROM price_snapshots ps
     JOIN markets m ON ps.market_id = m.id
     WHERE m.platform_id = $1 OR m.platform_id = $2
     ORDER BY ps.snapshot_at DESC
     LIMIT 6`,
    [p.poly_id, p.kalshi_id]
  );
  console.log('Snapshots:', snaps.rows);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
