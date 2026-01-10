const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_dKygRwI3nDQ0@ep-square-leaf-ah2imkwr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DATABASE_URL });

async function check() {
  try {
    // Count markets
    const markets = await pool.query('SELECT COUNT(*) as count FROM markets');
    const snapshots = await pool.query('SELECT COUNT(*) as count FROM price_snapshots');
    const recentSnapshots = await pool.query(
      "SELECT COUNT(*) as count FROM price_snapshots WHERE snapshot_at > NOW() - INTERVAL '1 hour'"
    );
    const lastSnapshot = await pool.query('SELECT MAX(snapshot_at) as last FROM price_snapshots');
    
    console.log('╔════════════════════════════════════════╗');
    console.log('║       DATABASE STATUS CHECK            ║');
    console.log('╠════════════════════════════════════════╣');
    console.log('║ Total Markets:      ', markets.rows[0].count.toString().padStart(15), '║');
    console.log('║ Total Snapshots:    ', snapshots.rows[0].count.toString().padStart(15), '║');
    console.log('║ Snapshots (1hr):    ', recentSnapshots.rows[0].count.toString().padStart(15), '║');
    console.log('║ Last Snapshot:                         ║');
    console.log('║   ', lastSnapshot.rows[0].last ? new Date(lastSnapshot.rows[0].last).toLocaleString() : 'None');
    console.log('╚════════════════════════════════════════╝');
    
    // Recent samples
    const samples = await pool.query(`
      SELECT m.platform, m.title, ps.yes_price, ps.volume_24h, ps.snapshot_at
      FROM price_snapshots ps
      JOIN markets m ON m.id = ps.market_id
      ORDER BY ps.snapshot_at DESC
      LIMIT 5
    `);
    
    if (samples.rows.length > 0) {
      console.log('\n📊 Recent Price Snapshots:');
      samples.rows.forEach((r, i) => {
        const price = parseFloat(r.yes_price).toFixed(3);
        const vol = parseFloat(r.volume_24h || 0).toLocaleString();
        console.log(`${i+1}. [${r.platform}] ${r.title.substring(0, 40)}...`);
        console.log(`   Price: ${price} | Volume: $${vol}`);
      });
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

check();
