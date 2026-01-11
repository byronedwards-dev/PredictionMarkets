import { query } from '../src/lib/db';

async function run() {
  const arbs = await query(
    `SELECT id,type,quality,gross_spread_pct,total_fees_pct,net_spread_pct,max_deployable_usd,details
     FROM arb_opportunities
     WHERE resolved_at IS NULL
     ORDER BY net_spread_pct DESC
     LIMIT 10`
  );
  console.log(JSON.stringify(arbs.rows, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
