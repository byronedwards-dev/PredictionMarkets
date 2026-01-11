/**
 * Database Migration Script
 * 
 * Creates the PostgreSQL schema for the Prediction Market Scanner
 * Run with: npm run db:migrate
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load .env.local if it exists
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/prediction_markets';

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const schema = `
-- ===========================================
-- PLATFORM CONFIGURATION (fees are here!)
-- ===========================================

-- Platform fee configuration (EASILY ADJUSTABLE)
CREATE TABLE IF NOT EXISTS platform_config (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL UNIQUE,
    
    -- Trading fees (as decimal, e.g., 0.02 = 2%)
    taker_fee_pct DECIMAL(6, 4) NOT NULL DEFAULT 0.02,
    maker_fee_pct DECIMAL(6, 4) NOT NULL DEFAULT 0.00,
    
    -- Settlement/withdrawal fees
    settlement_fee_pct DECIMAL(6, 4) NOT NULL DEFAULT 0.00,
    withdrawal_fee_flat DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    
    -- Fee metadata
    fee_notes TEXT,
    last_verified_at TIMESTAMP,
    
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Fee change history (audit trail)
CREATE TABLE IF NOT EXISTS platform_fee_history (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL,
    field_changed VARCHAR(50) NOT NULL,
    old_value DECIMAL(10, 4),
    new_value DECIMAL(10, 4),
    changed_at TIMESTAMP DEFAULT NOW(),
    change_reason TEXT
);

-- ===========================================
-- CORE MARKET DATA
-- ===========================================

-- Core market data (unified across platforms)
CREATE TABLE IF NOT EXISTS markets (
    id SERIAL PRIMARY KEY,
    platform VARCHAR(20) NOT NULL,
    platform_id VARCHAR(255) NOT NULL,
    event_id VARCHAR(255),
    title TEXT NOT NULL,
    category VARCHAR(100),
    sport VARCHAR(20),
    status VARCHAR(20) NOT NULL,
    resolution_date TIMESTAMP,
    outcome VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(platform, platform_id)
);

-- Create indexes safely (drop first if they exist with wrong definition)
DROP INDEX IF EXISTS idx_markets_platform_status;
DROP INDEX IF EXISTS idx_markets_sport;
DROP INDEX IF EXISTS idx_markets_status;
CREATE INDEX idx_markets_platform_status ON markets(platform, status);
CREATE INDEX idx_markets_sport ON markets(sport) WHERE sport IS NOT NULL;
CREATE INDEX idx_markets_status ON markets(status);

-- ===========================================
-- PRICE & LIQUIDITY SNAPSHOTS
-- ===========================================

-- Price snapshots with LIQUIDITY DATA (taken every 5 min)
CREATE TABLE IF NOT EXISTS price_snapshots (
    id SERIAL PRIMARY KEY,
    market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    
    -- Prices (mid-market)
    yes_price DECIMAL(10, 4),
    no_price DECIMAL(10, 4),
    
    -- Bid/Ask prices (what you can actually execute at)
    yes_bid DECIMAL(10, 4),
    yes_ask DECIMAL(10, 4),
    no_bid DECIMAL(10, 4),
    no_ask DECIMAL(10, 4),
    
    -- LIQUIDITY: Size available at best bid/ask (in USD)
    yes_bid_size DECIMAL(20, 2),
    yes_ask_size DECIMAL(20, 2),
    no_bid_size DECIMAL(20, 2),
    no_ask_size DECIMAL(20, 2),
    
    -- Aggregate metrics
    volume_24h DECIMAL(20, 2),
    volume_all_time DECIMAL(20, 2),
    open_interest DECIMAL(20, 2),
    
    -- Backfill tracking
    is_backfill BOOLEAN DEFAULT FALSE,
    
    snapshot_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_market_time ON price_snapshots(market_id, snapshot_at DESC);

-- ===========================================
-- TRADE HISTORY & VOLUME
-- ===========================================

-- Trade history (for volume spike detection)
CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    platform_trade_id VARCHAR(255),
    side VARCHAR(10),
    outcome VARCHAR(10),
    price DECIMAL(10, 4),
    size DECIMAL(20, 2),
    value_usd DECIMAL(20, 2),
    traded_at TIMESTAMP,
    UNIQUE(market_id, platform_trade_id)
);

CREATE INDEX IF NOT EXISTS idx_trades_market_time ON trades(market_id, traded_at DESC);

-- Daily volume aggregates (for faster spike detection)
CREATE TABLE IF NOT EXISTS daily_volume_stats (
    id SERIAL PRIMARY KEY,
    market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    volume_usd DECIMAL(20, 2),
    trade_count INTEGER,
    UNIQUE(market_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_volume_market_date ON daily_volume_stats(market_id, date DESC);

-- ===========================================
-- CROSS-PLATFORM MATCHING
-- ===========================================

-- Cross-platform market pairs (from Dome matching)
CREATE TABLE IF NOT EXISTS market_pairs (
    id SERIAL PRIMARY KEY,
    poly_market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    kalshi_market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    sport VARCHAR(20),
    game_date DATE,
    match_confidence DECIMAL(5, 2),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(poly_market_id, kalshi_market_id)
);

-- ===========================================
-- ARBITRAGE OPPORTUNITIES
-- ===========================================

-- Arb quality type
DO $$ BEGIN
    CREATE TYPE arb_quality AS ENUM ('theoretical', 'thin', 'executable');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Detected arbitrage opportunities
CREATE TABLE IF NOT EXISTS arb_opportunities (
    id SERIAL PRIMARY KEY,
    
    -- Classification
    type VARCHAR(50) NOT NULL,
    quality arb_quality NOT NULL,
    
    -- Market references
    market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    market_pair_id INTEGER REFERENCES market_pairs(id) ON DELETE CASCADE,
    
    -- Spread calculations (GROSS - before fees)
    gross_spread_pct DECIMAL(10, 4),
    
    -- Fee-adjusted calculations (NET - after fees)
    total_fees_pct DECIMAL(10, 4),
    net_spread_pct DECIMAL(10, 4),
    
    -- Liquidity context
    max_deployable_usd DECIMAL(20, 2),
    capital_weighted_spread DECIMAL(20, 2),
    
    -- Full calculation details
    details JSONB,
    
    -- Lifecycle tracking
    detected_at TIMESTAMP DEFAULT NOW(),
    last_seen_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    
    -- Persistence metrics (for reality check)
    snapshot_count INTEGER DEFAULT 1,
    duration_seconds INTEGER DEFAULT 0,
    
    -- Outcome tracking
    was_executed BOOLEAN DEFAULT FALSE,
    execution_result JSONB
);

CREATE INDEX IF NOT EXISTS idx_arb_opportunities_type_quality ON arb_opportunities(type, quality);
CREATE INDEX IF NOT EXISTS idx_arb_opportunities_detected ON arb_opportunities(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_arb_opportunities_active ON arb_opportunities(resolved_at) WHERE resolved_at IS NULL;

-- ===========================================
-- VOLUME ALERTS
-- ===========================================

CREATE TABLE IF NOT EXISTS volume_alerts (
    id SERIAL PRIMARY KEY,
    market_id INTEGER REFERENCES markets(id) ON DELETE CASCADE,
    
    -- Current volume
    volume_usd DECIMAL(20, 2),
    
    -- Statistical context
    rolling_avg_7d DECIMAL(20, 2),
    rolling_stddev_7d DECIMAL(20, 2),
    z_score DECIMAL(10, 4),
    multiplier DECIMAL(10, 2),
    
    -- Market context
    market_age_hours INTEGER,
    
    alert_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_volume_alerts_time ON volume_alerts(alert_at DESC);

-- ===========================================
-- BACKTESTING
-- ===========================================

CREATE TABLE IF NOT EXISTS backtest_runs (
    id SERIAL PRIMARY KEY,
    strategy_name VARCHAR(100),
    strategy_params JSONB,
    
    -- Fee configuration used
    fee_config_snapshot JSONB,
    
    -- Date range
    start_date DATE,
    end_date DATE,
    
    -- Results
    total_trades INTEGER,
    win_rate DECIMAL(5, 2),
    total_return_gross DECIMAL(10, 4),
    total_return_net DECIMAL(10, 4),
    total_fees_paid DECIMAL(10, 4),
    sharpe_ratio DECIMAL(10, 4),
    max_drawdown DECIMAL(10, 4),
    
    -- Detailed results
    results_detail JSONB,
    
    run_at TIMESTAMP DEFAULT NOW()
);

-- ===========================================
-- REALITY CHECK METRICS
-- ===========================================

CREATE TABLE IF NOT EXISTS reality_check_daily (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    
    -- Arb persistence
    total_arbs_detected INTEGER,
    arbs_persisted_5min INTEGER,
    arbs_persisted_30min INTEGER,
    pct_persisted_5min DECIMAL(5, 2),
    pct_persisted_30min DECIMAL(5, 2),
    
    -- Arb quality distribution
    arbs_executable INTEGER,
    arbs_thin INTEGER,
    arbs_theoretical INTEGER,
    
    -- Liquidity metrics
    median_max_deployable DECIMAL(20, 2),
    avg_max_deployable DECIMAL(20, 2),
    total_deployable_opportunity DECIMAL(20, 2),
    
    -- Net profitability
    avg_net_spread_pct DECIMAL(10, 4),
    median_net_spread_pct DECIMAL(10, 4),
    
    computed_at TIMESTAMP DEFAULT NOW()
);

-- ===========================================
-- SYNC STATUS
-- ===========================================

CREATE TABLE IF NOT EXISTS sync_status (
    id SERIAL PRIMARY KEY,
    sync_type VARCHAR(50) NOT NULL,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running',
    markets_synced INTEGER DEFAULT 0,
    arbs_detected INTEGER DEFAULT 0,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_status_time ON sync_status(started_at DESC);
`;

const seedData = `
-- Seed initial fee configuration
INSERT INTO platform_config (platform, taker_fee_pct, maker_fee_pct, fee_notes) VALUES
    ('polymarket', 0.02, 0.00, 'Approx 2% spread-based fee, varies by market liquidity'),
    ('kalshi', 0.01, 0.00, 'Approximately $0.01-0.02 per contract, modeled as 1%')
ON CONFLICT (platform) DO NOTHING;
`;

async function migrate() {
  console.log('🚀 Starting database migration...');
  console.log(`📍 Database URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  
  const client = await pool.connect();
  
  try {
    // Drop existing tables for clean slate
    console.log('🗑️  Dropping existing tables...');
    await client.query(`
      DROP TABLE IF EXISTS volume_alerts CASCADE;
      DROP TABLE IF EXISTS reality_check_daily CASCADE;
      DROP TABLE IF EXISTS backtest_runs CASCADE;
      DROP TABLE IF EXISTS arb_opportunities CASCADE;
      DROP TABLE IF EXISTS market_pairs CASCADE;
      DROP TABLE IF EXISTS daily_volume_stats CASCADE;
      DROP TABLE IF EXISTS trades CASCADE;
      DROP TABLE IF EXISTS price_snapshots CASCADE;
      DROP TABLE IF EXISTS markets CASCADE;
      DROP TABLE IF EXISTS platform_fee_history CASCADE;
      DROP TABLE IF EXISTS platform_config CASCADE;
      DROP TABLE IF EXISTS sync_status CASCADE;
      DROP TYPE IF EXISTS arb_quality CASCADE;
    `);
    console.log('✅ Existing tables dropped');

    // Run schema creation
    console.log('📝 Creating schema...');
    await client.query(schema);
    console.log('✅ Schema created successfully');
    
    // Run seed data
    console.log('🌱 Seeding initial data...');
    await client.query(seedData);
    console.log('✅ Seed data inserted');
    
    // Verify tables
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log('\\n📊 Tables created:');
    tableCheck.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    console.log('\\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
