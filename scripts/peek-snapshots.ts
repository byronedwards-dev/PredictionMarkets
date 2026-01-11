import { query } from '../src/lib/db';

async function run() {
  const res = await query(
    `SELECT m.platform, m.platform_id, ps.yes_bid, ps.no_bid, ps.yes_price, ps.no_price, ps.snapshot_at
     FROM price_snapshots ps
     JOIN markets m ON ps.market_id = m.id
     WHERE m.platform_id IN ('nfl-gb-chi-2026-01-10','KXNFLGAME-26JAN10GBCHI-CHI')
     ORDER BY ps.snapshot_at DESC
     LIMIT 12`
  );
  console.log(res.rows);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
