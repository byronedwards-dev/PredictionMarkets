const { Pool } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_dKygRwI3nDQ0@ep-square-leaf-ah2imkwr-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require';
const pool = new Pool({ connectionString: DATABASE_URL });

async function check() {
  const result = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'price_snapshots'
    ORDER BY ordinal_position
  `);
  console.log('price_snapshots columns:');
  result.rows.forEach(r => console.log('  -', r.column_name, ':', r.data_type));
  
  const markets = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'markets'
    ORDER BY ordinal_position
  `);
  console.log('\nmarkets columns:');
  markets.rows.forEach(r => console.log('  -', r.column_name, ':', r.data_type));
  
  await pool.end();
}
check();
