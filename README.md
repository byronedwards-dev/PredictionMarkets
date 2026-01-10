# Prediction Market Arbitrage Scanner

A local-only tool for monitoring prediction markets across Polymarket and Kalshi, detecting arbitrage opportunities, flagging suspicious volume activity, and backtesting trading strategies.

## Features

- **Real-time Arbitrage Detection**: Monitors markets for underround (single-market) and cross-platform arbitrage opportunities
- **Fee-Adjusted Calculations**: All spreads are calculated net of platform fees
- **Liquidity Awareness**: Shows maximum deployable capital and potential profit
- **Quality Classification**: Categorizes opportunities as Executable, Thin, or Theoretical
- **Volume Spike Detection**: Statistical detection of unusual trading activity (z-score based)
- **Configurable Fees**: Easy-to-update platform fee configuration with audit trail

## Tech Stack

- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Database**: PostgreSQL (local)
- **Data Source**: Dome API (Dev tier - 100 QPS)

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Dome API key

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Update the values:
- `DOME_API_KEY`: Your Dome API key
- `DATABASE_URL`: PostgreSQL connection string

### 3. Create Database

```sql
CREATE DATABASE prediction_markets;
```

### 4. Run Migrations

```bash
npm run db:migrate
```

This creates all necessary tables and seeds initial fee configuration.

### 5. Start the Application

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 6. Start the Sync Job

In a separate terminal:

```bash
npm run jobs:sync
```

This polls the Dome API every 5 minutes to sync market data and detect arbitrage.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/               # API routes
│   │   ├── arbs/          # Arbitrage opportunities endpoint
│   │   ├── fees/          # Fee configuration endpoint
│   │   ├── markets/       # Markets data endpoint
│   │   └── stats/         # Dashboard statistics
│   ├── arbs/              # Arbitrage page
│   ├── markets/           # Markets browser page
│   ├── settings/          # Settings/fee config page
│   ├── volume/            # Volume alerts page
│   └── page.tsx           # Dashboard
├── components/            # React components
│   ├── ArbCard.tsx        # Arbitrage opportunity card
│   ├── MarketTable.tsx    # Markets data table
│   ├── Navbar.tsx         # Navigation bar
│   └── StatCard.tsx       # Statistics card
├── jobs/                  # Background jobs
│   └── sync-markets.ts    # Market sync job
└── lib/                   # Utility libraries
    ├── arb-detection.ts   # Arbitrage detection logic
    ├── db.ts              # Database connection
    ├── dome-api.ts        # Dome API client
    ├── fees.ts            # Fee configuration
    └── utils.ts           # Utility functions
```

## Arbitrage Detection

### Single-Market (Underround)

An underround exists when `YES_bid + NO_bid < 1.00`. This means you can buy both sides for less than the guaranteed payout.

**Quality Thresholds:**
| Quality | Net Spread | Max Deployable |
|---------|-----------|----------------|
| Executable | ≥2% | ≥$1,000 |
| Thin | ≥2% | $100 - $999 |
| Theoretical | ≥2% | <$100 |

### Cross-Platform

Compares matched markets across Polymarket and Kalshi to find opportunities where buying YES on one platform and NO on another yields a guaranteed profit.

## Fee Configuration

Fees are stored in the `platform_config` table and can be updated via:

1. **Settings UI**: Navigate to `/settings` to update fees with an audit trail
2. **Direct SQL**:

```sql
UPDATE platform_config 
SET taker_fee_pct = 0.01, updated_at = NOW()
WHERE platform = 'polymarket';
```

**Current Default Fees:**
| Platform | Taker Fee | Maker Fee |
|----------|-----------|-----------|
| Polymarket | 2% | 0% |
| Kalshi | 1% | 0% |

## Volume Spike Detection

Uses statistical analysis to detect unusual trading activity:

- **Z-Score ≥ 2.5**: Volume is 2.5+ standard deviations above 7-day average
- **Absolute Volume ≥ $10,000**: Filters out noise on illiquid markets
- **Market Age ≥ 48 hours**: New markets naturally have erratic volume

## API Endpoints

### GET /api/stats
Returns dashboard statistics including market counts, arb summary, and last sync status.

### GET /api/markets
Returns markets with optional filters:
- `platform`: polymarket, kalshi
- `sport`: nfl, nba, mlb, nhl
- `status`: open, closed
- `minVolume`: minimum 24h volume
- `hasArb`: true to show only markets with active arbs

### GET /api/arbs
Returns active arbitrage opportunities with optional filters:
- `type`: underround, cross_platform
- `quality`: executable, thin, theoretical (comma-separated)
- `minSpread`: minimum net spread percentage
- `minDeployable`: minimum deployable capital

### GET/PUT /api/fees
Get or update platform fee configuration.

## Development

```bash
# Run development server
npm run dev

# Run sync job
npm run jobs:sync

# Run database migration
npm run db:migrate

# Lint code
npm run lint

# Build for production
npm run build
```

## License

MIT
