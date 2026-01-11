# Prediction Market Scanner - Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Data Flow](#data-flow)
4. [Database Schema](#database-schema)
5. [API Endpoints](#api-endpoints)
6. [Key Features](#key-features)
7. [Codebase Structure](#codebase-structure)
8. [Configuration](#configuration)
9. [Known Limitations](#known-limitations)

---

## Overview

The Prediction Market Scanner is a Next.js application that monitors prediction markets on **Polymarket** and **Kalshi** to:

1. **Track market prices** - Snapshots every 5 minutes
2. **Detect arbitrage opportunities** - Single-market underrounds and cross-platform arbs
3. **Match cross-platform markets** - Same event on both platforms (sports focus)
4. **Alert on volume spikes** - Unusual trading activity detection

### Tech Stack
- **Frontend**: Next.js 14 (App Router), React, TailwindCSS
- **Backend**: Next.js API Routes, Node.js background worker
- **Database**: PostgreSQL (hosted on Railway)
- **Data Source**: [Dome API](https://docs.domeapi.io/) - unified prediction market data
- **Deployment**: Railway

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DOME API                                     │
│  (Polymarket + Kalshi unified data: markets, prices, orderbooks)    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SYNC WORKER (Background Job)                      │
│                    src/jobs/sync-markets.ts                          │
│                                                                      │
│  Every 5 minutes:                                                    │
│  1. Fetch top 200 markets from each platform                         │
│  2. Upsert markets into database                                     │
│  3. Fetch real-time prices + orderbook top-of-book                   │
│  4. Store price snapshots                                            │
│  5. Detect single-market arbitrage (underround)                      │
│  6. Fetch cross-platform matched markets (sports)                    │
│  7. Detect cross-platform arbitrage                                  │
│  8. Check for volume spikes (candlesticks)                           │
│  9. Close stale arbs                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        POSTGRESQL DATABASE                           │
│                                                                      │
│  Tables:                                                             │
│  - markets (unified market data)                                     │
│  - price_snapshots (time-series price/volume data)                   │
│  - market_pairs (cross-platform matched markets)                     │
│  - arb_opportunities (detected arbitrage)                            │
│  - volume_alerts (unusual activity)                                  │
│  - platform_config (fee configuration)                               │
│  - sync_status (job tracking)                                        │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      NEXT.JS API ROUTES                              │
│                                                                      │
│  /api/stats     - Dashboard statistics                               │
│  /api/markets   - Market listings with filters                       │
│  /api/markets/[id] - Single market detail + history                  │
│  /api/arbs      - Active arbitrage opportunities                     │
│  /api/pairs     - Cross-platform market pairs                        │
│  /api/volume-alerts - Volume spike alerts                            │
│  /api/fees      - Platform fee configuration                         │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                              │
│                                                                      │
│  /           - Dashboard (stats, top arbs)                           │
│  /markets    - Market explorer with filters                          │
│  /markets/[id] - Market detail with charts                           │
│  /pairs      - Cross-platform comparison                             │
│  /arbs       - Arbitrage opportunities                               │
│  /volume     - Volume spike alerts                                   │
│  /settings   - Fee configuration                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Market Data Ingestion

```
Dome API                    Sync Worker                    Database
   │                            │                             │
   │  GET /polymarket/markets   │                             │
   │<───────────────────────────│                             │
   │  (top 200 by volume)       │                             │
   │───────────────────────────>│                             │
   │                            │  UPSERT markets             │
   │                            │────────────────────────────>│
   │                            │                             │
   │  GET /polymarket/market-price/{tokenId}                  │
   │<───────────────────────────│                             │
   │  (for each high-volume market)                           │
   │───────────────────────────>│                             │
   │                            │                             │
   │  GET /polymarket/orderbooks                              │
   │<───────────────────────────│                             │
   │  (top-of-book bid/ask)     │                             │
   │───────────────────────────>│                             │
   │                            │  INSERT price_snapshots     │
   │                            │────────────────────────────>│
```

### 2. Arbitrage Detection

**Single-Market (Underround):**
```
An "underround" exists when:  YES_bid + NO_bid < 1.00

Example:
  YES bid = 0.45 (you can buy YES for $0.45)
  NO bid  = 0.52 (you can buy NO for $0.52)
  Total   = 0.97

  Gross spread = 1.00 - 0.97 = 3%
  Fees (2% per side) = 4%
  Net spread = 3% - 4% = -1% (NOT profitable after fees)
```

**Cross-Platform:**
```
Arb exists when buying YES on platform A + NO on platform B < $1.00

Example:
  Polymarket YES = 0.48
  Kalshi NO = 0.49
  Total = 0.97

  If outcome is YES:  Win $1 on Poly, lose $0.49 on Kalshi = +$0.03
  If outcome is NO:   Lose $0.48 on Poly, win $1 on Kalshi = +$0.03

  Guaranteed profit (before fees)
```

### 3. Price Snapshot Storage

Each snapshot stores:
- `yes_price`, `no_price` - Mid-market prices
- `yes_bid`, `yes_ask`, `no_bid`, `no_ask` - Actual orderbook prices
- `yes_bid_size`, `no_bid_size` - Liquidity available at best price
- `volume_24h`, `volume_all_time` - Trading volume

### 4. Volume Spike Detection

```
Dome API                    Sync Worker                    Database
   │                            │                             │
   │  GET /polymarket/candlesticks                            │
   │  (1h candles, 24h lookback)│                             │
   │<───────────────────────────│                             │
   │───────────────────────────>│                             │
   │                            │                             │
   │                            │  Calculate:                 │
   │                            │  - 24h average hourly volume│
   │                            │  - Current hour volume      │
   │                            │  - Multiplier = current/avg │
   │                            │                             │
   │                            │  If multiplier >= 2x:       │
   │                            │  INSERT volume_alerts       │
   │                            │────────────────────────────>│
```

---

## Database Schema

### Core Tables

#### `markets`
Unified market data from both platforms.

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Internal ID |
| platform | VARCHAR(20) | 'polymarket' or 'kalshi' |
| platform_id | VARCHAR(255) | Market slug (Poly) or ticker (Kalshi) |
| event_id | VARCHAR(255) | Groups related markets |
| title | TEXT | Market question |
| category | VARCHAR(100) | Primary tag |
| sport | VARCHAR(20) | NFL, NBA, etc. (if applicable) |
| status | VARCHAR(20) | 'open' or 'closed' |
| resolution_date | TIMESTAMP | When market resolves |
| outcome | VARCHAR(50) | Winning side (if resolved) |
| token_id_a | VARCHAR | Polymarket YES token ID |
| token_id_b | VARCHAR | Polymarket NO token ID |

#### `price_snapshots`
Time-series price and volume data.

| Column | Type | Description |
|--------|------|-------------|
| market_id | INTEGER | FK to markets |
| yes_price | DECIMAL | Mid-market YES price (0-1) |
| no_price | DECIMAL | Mid-market NO price (0-1) |
| yes_bid | DECIMAL | Best bid for YES |
| yes_ask | DECIMAL | Best ask for YES |
| yes_bid_size | DECIMAL | USD available at best bid |
| volume_24h | DECIMAL | 24-hour trading volume |
| volume_all_time | DECIMAL | Lifetime trading volume |
| snapshot_at | TIMESTAMP | When snapshot was taken |

#### `market_pairs`
Cross-platform matched markets (from Dome matching API).

| Column | Type | Description |
|--------|------|-------------|
| poly_market_id | INTEGER | FK to Polymarket market |
| kalshi_market_id | INTEGER | FK to Kalshi market |
| sport | VARCHAR(20) | Sport category |
| game_date | DATE | When the game occurs |
| match_confidence | DECIMAL | Matching confidence (0-1) |

#### `arb_opportunities`
Detected arbitrage opportunities with lifecycle tracking.

| Column | Type | Description |
|--------|------|-------------|
| type | VARCHAR | 'underround' or 'cross_platform' |
| quality | ENUM | 'executable', 'thin', 'theoretical' |
| market_id | INTEGER | For single-market arbs |
| market_pair_id | INTEGER | For cross-platform arbs |
| gross_spread_pct | DECIMAL | Pre-fee spread |
| total_fees_pct | DECIMAL | Combined platform fees |
| net_spread_pct | DECIMAL | Post-fee spread |
| max_deployable_usd | DECIMAL | Capital limited by liquidity |
| detected_at | TIMESTAMP | First seen |
| last_seen_at | TIMESTAMP | Most recent confirmation |
| resolved_at | TIMESTAMP | When arb closed |
| snapshot_count | INTEGER | How many syncs it persisted |

#### `volume_alerts`
Unusual trading activity.

| Column | Type | Description |
|--------|------|-------------|
| market_id | INTEGER | FK to markets |
| volume_usd | DECIMAL | Current volume |
| rolling_avg_7d | DECIMAL | Average volume (actually 24h) |
| multiplier | DECIMAL | volume / average |
| z_score | DECIMAL | Statistical significance |
| alert_at | TIMESTAMP | When alert triggered |

#### `platform_config`
Fee configuration (editable via Settings page).

| Column | Type | Description |
|--------|------|-------------|
| platform | VARCHAR | 'polymarket' or 'kalshi' |
| taker_fee_pct | DECIMAL | Fee for market orders (0.02 = 2%) |
| maker_fee_pct | DECIMAL | Fee for limit orders |
| settlement_fee_pct | DECIMAL | Fee on winning payouts |

---

## API Endpoints

### GET `/api/stats`
Dashboard statistics.

**Response:**
```json
{
  "markets": { "total": 500, "active": 420 },
  "platforms": {
    "polymarket": { "markets": 250, "volume24h": 5000000 },
    "kalshi": { "markets": 250, "volume24h": 2000000 }
  },
  "arbs": {
    "active": 5,
    "avgSpread": 2.5,
    "totalDeployable": 50000
  },
  "snapshots": { "total": 150000, "last24h": 5000 },
  "events": { "total": 200, "active": 150, "closed": 50 },
  "lastSync": "2025-01-11T10:00:00Z"
}
```

### GET `/api/markets`
Paginated market list with filters.

**Query Parameters:**
- `status` - 'open', 'closed', or 'all' (default: 'open')
- `platform` - 'polymarket', 'kalshi', or 'all'
- `category` - Filter by category tag
- `search` - Search title
- `sort` - 'volume', 'price', 'spread'
- `page`, `limit` - Pagination
- `hideResolved` - Hide 0%/100% markets (default: true)

**Response:**
```json
{
  "events": [
    {
      "event_id": "...",
      "title": "Super Bowl LVIII Winner",
      "total_volume": 5000000,
      "markets": [
        {
          "id": 123,
          "platform": "polymarket",
          "title": "Kansas City Chiefs to win",
          "yes_price": "0.52",
          "volume_24h": "50000"
        }
      ]
    }
  ],
  "pagination": { "page": 1, "limit": 50, "total": 500 }
}
```

### GET `/api/markets/[id]`
Single market with price history.

**Response:**
```json
{
  "market": {
    "id": 123,
    "title": "...",
    "platform": "polymarket",
    "status": "open"
  },
  "snapshots": [
    { "snapshot_at": "...", "yes_price": 0.52, "volume_24h": 50000 }
  ]
}
```

### GET `/api/pairs`
Cross-platform matched markets.

**Query Parameters:**
- `sport` - Filter by sport (nfl, nba, etc.)
- `activeOnly` - Only open markets (default: true)
- `minSpread` - Minimum spread threshold

**Response:**
```json
{
  "pairs": [
    {
      "id": 1,
      "sport": "nfl",
      "gameDate": "2025-01-12",
      "polymarket": {
        "title": "Chiefs to win",
        "yesPrice": 0.52,
        "volume24h": 50000
      },
      "kalshi": {
        "title": "Kansas City Chiefs Win",
        "yesPrice": 0.51,
        "volume24h": 20000
      },
      "spread": {
        "value": 0.03,
        "direction": "buy_poly_yes"
      }
    }
  ],
  "total": 10,
  "sports": ["nfl", "nba"]
}
```

### GET `/api/arbs`
Active arbitrage opportunities.

**Query Parameters:**
- `type` - 'underround' or 'cross_platform'
- `quality` - 'executable', 'thin', 'theoretical'
- `minSpread` - Minimum net spread

### GET `/api/volume-alerts`
Volume spike alerts.

**Query Parameters:**
- `hours` - Lookback period (default: 24)
- `minMultiplier` - Minimum spike (default: 1.5)

---

## Key Features

### 1. Market Explorer (`/markets`)

- **Event Grouping**: Markets are grouped by `event_id` (e.g., all Super Bowl outcomes together)
- **Sorting**: Markets within events sorted by YES price (descending)
- **Filters**: Platform, status, category, search
- **Resolved Filter**: Hides markets at 0% or 100% (effectively resolved)
- **Dual Volume Display**: Shows both 24h and all-time volume

### 2. Cross-Platform Pairs (`/pairs`)

- **Source**: Dome API's matching markets endpoint (sports-focused)
- **Sports Supported**: NFL, NBA, MLB, NHL, CFB, CBB
- **Spread Calculation**: Shows potential arb spread between platforms
- **Side Alignment**: Currently assumes YES on Poly = YES on Kalshi (⚠️ may need verification)

### 3. Arbitrage Detection (`/arbs`)

**Quality Classification:**
- **Executable**: Net spread ≥2%, deployable capital ≥$1,000
- **Thin**: Net spread ≥2%, deployable capital $100-$999
- **Theoretical**: Net spread ≥2%, deployable capital <$100

**Fee Handling:**
- Polymarket: ~2% taker fee
- Kalshi: ~1% taker fee
- Fees are subtracted from gross spread to get net spread

**Persistence Tracking:**
- `snapshot_count`: How many 5-minute syncs the arb has persisted
- `duration_seconds`: Total time the arb has been active
- Arbs are "resolved" (closed) if not seen for 10 minutes

### 4. Volume Alerts (`/volume`)

- **Data Source**: Dome API candlesticks (hourly OHLCV)
- **Detection**: Current hour volume vs 24h average
- **Threshold**: 2x average triggers alert
- **Minimum Volume**: $1,000 to filter noise

---

## Codebase Structure

```
src/
├── app/                      # Next.js App Router
│   ├── api/                  # API Routes
│   │   ├── arbs/route.ts
│   │   ├── fees/route.ts
│   │   ├── markets/
│   │   │   ├── route.ts      # Market list
│   │   │   └── [id]/route.ts # Market detail
│   │   ├── pairs/route.ts
│   │   ├── stats/route.ts
│   │   └── volume-alerts/route.ts
│   ├── arbs/page.tsx         # Arbitrage page
│   ├── markets/
│   │   ├── page.tsx          # Market explorer
│   │   └── [id]/page.tsx     # Market detail
│   ├── pairs/page.tsx        # Cross-platform pairs
│   ├── volume/page.tsx       # Volume alerts
│   ├── settings/page.tsx     # Fee configuration
│   ├── page.tsx              # Dashboard
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── Navbar.tsx
│   ├── MarketTable.tsx
│   ├── ArbCard.tsx
│   └── StatCard.tsx
├── lib/
│   ├── db.ts                 # PostgreSQL connection
│   ├── dome-api.ts           # Dome API client
│   ├── arb-detection.ts      # Arb detection logic
│   ├── volume-alerts.ts      # Volume spike detection
│   ├── fees.ts               # Fee calculations
│   └── utils.ts              # Formatting helpers
├── jobs/
│   └── sync-markets.ts       # Background sync job
└── worker.ts                 # Worker entry point
```

### Key Files

#### `src/lib/dome-api.ts`
Dome API client with rate limiting.

```typescript
// Key methods:
polymarket.getMarkets()       // List markets
polymarket.getMarketPrice()   // Current price
polymarket.getOrderbooks()    // Orderbook snapshots
polymarket.getCandlesticks()  // OHLCV candles

kalshi.getMarkets()           // List markets
kalshi.getOrderbooks()        // Orderbook snapshots

matchingMarkets.getBySport()  // Cross-platform matches
```

**Rate Limiting:**
- Sliding window: 480 requests per 10 seconds
- Per-second limit: 90 requests
- Automatic retry on 429 errors

#### `src/jobs/sync-markets.ts`
Background sync job (runs every 5 minutes).

**Flow:**
1. Fetch Polymarket markets (top 200 by volume)
2. Fetch Kalshi markets (top 200 by volume)
3. Upsert all markets to DB
4. For high-volume markets ($5k+):
   - Fetch real-time price
   - Fetch orderbook top-of-book
   - Store snapshot
   - Check for single-market arb
5. Fetch cross-platform matches (sports)
6. Fetch missing paired markets
7. Store market pairs
8. Check for cross-platform arbs
9. Check for volume spikes
10. Close stale arbs

#### `src/lib/arb-detection.ts`
Arbitrage detection logic.

```typescript
// Single-market detection
detectSingleMarketArb(snapshot, title)
// Returns if YES_bid + NO_bid < 0.98 (2%+ gross)

// Cross-platform detection
detectCrossPlatformArb(polySnapshot, kalshiSnapshot, pairId, titles)
// Checks both directions:
// - Buy Poly YES + Kalshi NO
// - Buy Poly NO + Kalshi YES

// Quality classification
classifyQuality(netSpread, maxDeployable)
// Returns 'executable' | 'thin' | 'theoretical'
```

---

## Configuration

### Environment Variables

```bash
# .env.local

# Dome API
DOME_API_KEY=your_api_key
DOME_API_BASE_URL=https://api.domeapi.io/v1

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Rate Limiting (optional - defaults shown)
DOME_RATE_LIMIT_QPS=90
DOME_RATE_LIMIT_WINDOW=480

# Sync Interval (optional - default 5 minutes)
SYNC_INTERVAL_MINUTES=5
```

### Platform Fees

Editable via `/settings` page or directly in `platform_config` table:

| Platform | Taker Fee | Maker Fee | Notes |
|----------|-----------|-----------|-------|
| Polymarket | 2% | 0% | Spread-based, varies by liquidity |
| Kalshi | 1% | 0% | Per-contract fee |

---

## Known Limitations

### 1. Cross-Platform Side Alignment
**Issue**: The system assumes "YES" on Polymarket = "YES" on Kalshi for the same event. This may not always be true (e.g., "Team A wins" vs "Team B loses").

**Impact**: Arb calculations may be inverted, showing false positives.

**Mitigation**: Dome's matching API is sport-focused and generally reliable, but manual verification recommended.

### 2. Kalshi Orderbook Data Quality
**Issue**: Some Kalshi markets return 0 or null prices from the orderbook API.

**Impact**: Markets appear "resolved" (filtered out) even when active.

**Mitigation**: Added fallback to `last_price` when orderbook is empty, plus validity guards.

### 3. Liquidity Estimation
**Issue**: `max_deployable_usd` uses `min(yes_bid_size, no_bid_size)`, but actual liquidity may differ.

**Impact**: Arbs may not be as large as indicated.

**Mitigation**: Use conservative estimates; actual execution requires depth analysis.

### 4. Fee Approximation
**Issue**: Polymarket fees vary by spread/liquidity; we use a flat 2% approximation.

**Impact**: Net spread calculations may be off by ~0.5-1%.

**Mitigation**: Configurable via Settings; adjust based on actual execution experience.

### 5. Volume Alerts - Polymarket Only
**Issue**: Candlestick endpoint only available for Polymarket, not Kalshi.

**Impact**: Volume spikes on Kalshi are not detected.

**Mitigation**: Could use snapshot-delta method for Kalshi (not implemented).

### 6. Stale Data During Low Activity
**Issue**: Markets with no recent trades may have stale snapshot data.

**Impact**: Arbs may appear based on outdated prices.

**Mitigation**: `last_seen_at` tracking; arbs auto-close after 10 minutes without confirmation.

---

## Running the Application

### Development

```bash
# Install dependencies
npm install

# Run database migration
npm run db:migrate

# Start Next.js dev server
npm run dev

# Start sync worker (separate terminal)
npm run jobs:sync
```

### Production (Railway)

The app deploys as two services:
1. **Web**: Next.js server (`npm start`)
2. **Worker**: Background sync (`npm run jobs:sync`)

Both share the same DATABASE_URL and DOME_API_KEY.

---

## API Rate Budget

With Dev tier (100 QPS, 500/10sec), each sync uses approximately:

| Operation | Calls | Notes |
|-----------|-------|-------|
| Polymarket markets | 2 | 2 pages × 100 |
| Kalshi markets | 2 | 2 pages × 100 |
| Polymarket prices | ~100 | High-volume markets |
| Polymarket orderbooks | ~200 | 2 per market (YES/NO) |
| Kalshi orderbooks | ~100 | 1 per market |
| Matching markets | ~10 | 5 sports × 2 days |
| Candlesticks | ~50 | Top 50 for volume |

**Total per sync**: ~465 calls
**Sync interval**: 5 minutes
**Effective rate**: ~1.5 calls/second (well under limits)
