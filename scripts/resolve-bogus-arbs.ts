import { query } from '../src/lib/db';

async function run() {
  const res = await query(
    `UPDATE arb_opportunities
     SET resolved_at = NOW()
     WHERE resolved_at IS NULL
       AND net_spread_pct > 100`
  );
  console.log('Resolved bogus arbs:', res.rowCount);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
