const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_dKygRwI3nDQ0@ep-square-leaf-ah2imkwr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DATABASE_URL });

async function check() {
  try {
    console.log('Current time:', new Date().toLocaleString());
    console.log('');
    
    // Last snapshot time
    const lastSnapshot = await pool.query('SELECT MAX(snapshot_at) as last FROM price_snapshots');
    const lastTime = lastSnapshot.rows[0].last;
    const minutesAgo = lastTime ? Math.round((Date.now() - new Date(lastTime).getTime()) / 60000) : 'N/A';
    console.log('Last snapshot:', lastTime ? new Date(lastTime).toLocaleString() : 'None');
    console.log('Minutes ago:', minutesAgo);
    console.log('');
    
    // Count snapshots in different time windows
    const counts = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE snapshot_at > NOW() - INTERVAL '5 minutes') as last_5min,
        COUNT(*) FILTER (WHERE snapshot_at > NOW() - INTERVAL '15 minutes') as last_15min,
        COUNT(*) FILTER (WHERE snapshot_at > NOW() - INTERVAL '1 hour') as last_hour
      FROM price_snapshots
    `);
    
    console.log('Snapshots by time window:');
    console.log('  Last 5 min:', counts.rows[0].last_5min);
    console.log('  Last 15 min:', counts.rows[0].last_15min);
    console.log('  Last hour:', counts.rows[0].last_hour);
    console.log('');
    
    // Recent sync status
    const syncs = await pool.query(`
      SELECT started_at, completed_at, status, markets_synced, error_message 
      FROM sync_status 
      ORDER BY started_at DESC 
      LIMIT 5
    `);
    
    console.log('Recent sync runs:');
    if (syncs.rows.length === 0) {
      console.log('  No sync runs recorded (Railway worker may not have sync_status logging)');
    } else {
      syncs.rows.forEach(r => {
        const time = new Date(r.started_at).toLocaleTimeString();
        console.log(`  ${time} - ${r.status} - ${r.markets_synced || 0} markets`);
        if (r.error_message) console.log(`    Error: ${r.error_message.substring(0, 50)}`);
      });
    }
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

check();
