'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, AlertCircle, TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/utils';

interface MarketSide {
  id: number;
  platformId: string;
  title: string;
  status: string;
  yesPrice: number;
  noPrice: number;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  volume24h: number;
  volumeAllTime: number;
  snapshotAt: string | null;
}

interface Pair {
  id: number;
  sport: string | null;
  gameDate: string | null;
  matchConfidence: number;
  polymarket: MarketSide;
  kalshi: MarketSide;
  spread: {
    value: number | null;
    direction: string | null;
    priceDiff: number | null;
  };
}

interface PairsResponse {
  pairs: Pair[];
  total: number;
  sports: string[];
}

function formatPrice(price: number): string {
  return `${(price * 100).toFixed(1)}¢`;
}

function PriceCell({ price, label, highlight }: { price: number; label: string; highlight?: 'high' | 'low' | null }) {
  let colorClass = 'text-white';
  if (highlight === 'high') colorClass = 'text-profit-mid';
  if (highlight === 'low') colorClass = 'text-accent-cyan';
  
  return (
    <div className="text-center">
      <div className="text-xs text-gray-500 uppercase">{label}</div>
      <div className={`font-mono text-lg ${colorClass}`}>{formatPrice(price)}</div>
    </div>
  );
}

function PairCard({ pair }: { pair: Pair }) {
  const priceDiff = pair.polymarket.yesPrice - pair.kalshi.yesPrice;
  const priceDiffPct = Math.abs(priceDiff) * 100;
  
  // Determine which side has better prices
  const polyYesCheaper = pair.polymarket.yesPrice < pair.kalshi.yesPrice;
  const polyNoCheaper = pair.polymarket.noPrice < pair.kalshi.noPrice;
  
  const hasSpread = pair.spread.value !== null && pair.spread.value > 0;
  
  return (
    <div className={`card p-4 ${hasSpread ? 'border-profit-low' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          {pair.sport && (
            <span className="text-xs font-medium text-accent-cyan uppercase tracking-wider">
              {pair.sport.toUpperCase()}
            </span>
          )}
          {pair.gameDate && (
            <span className="text-xs text-gray-500 ml-2">
              {new Date(pair.gameDate).toLocaleDateString()}
            </span>
          )}
        </div>
        {hasSpread && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-profit-low/20 text-profit-mid text-sm font-medium">
            <TrendingUp className="w-3 h-3" />
            {formatPercent(pair.spread.value! * 100)} spread
          </div>
        )}
      </div>

      {/* Side-by-side comparison */}
      <div className="grid grid-cols-2 gap-4">
        {/* Polymarket Side */}
        <div className="bg-terminal-bg rounded-lg p-3 border border-purple-500/30">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-purple-400">POLYMARKET</span>
            <a
              href={`https://polymarket.com/event/${pair.polymarket.platformId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="text-sm text-gray-300 mb-3 line-clamp-2" title={pair.polymarket.title}>
            {pair.polymarket.title}
          </div>
          <div className="flex justify-around">
            <PriceCell 
              price={pair.polymarket.yesPrice} 
              label="YES" 
              highlight={polyYesCheaper ? 'low' : null}
            />
            <PriceCell 
              price={pair.polymarket.noPrice} 
              label="NO"
              highlight={polyNoCheaper ? 'low' : null}
            />
          </div>
          <div className="mt-2 text-xs text-gray-500 text-center">
            Vol: {formatCurrency(pair.polymarket.volume24h, 0)}
          </div>
        </div>

        {/* Kalshi Side */}
        <div className="bg-terminal-bg rounded-lg p-3 border border-blue-500/30">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-blue-400">KALSHI</span>
            <a
              href={`https://kalshi.com/markets/${pair.kalshi.platformId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="text-sm text-gray-300 mb-3 line-clamp-2" title={pair.kalshi.title}>
            {pair.kalshi.title}
          </div>
          <div className="flex justify-around">
            <PriceCell 
              price={pair.kalshi.yesPrice} 
              label="YES"
              highlight={!polyYesCheaper ? 'low' : null}
            />
            <PriceCell 
              price={pair.kalshi.noPrice} 
              label="NO"
              highlight={!polyNoCheaper ? 'low' : null}
            />
          </div>
          <div className="mt-2 text-xs text-gray-500 text-center">
            Vol: {formatCurrency(pair.kalshi.volume24h, 0)}
          </div>
        </div>
      </div>

      {/* Price difference indicator */}
      <div className="mt-3 flex items-center justify-center gap-2 text-sm">
        {priceDiffPct > 1 ? (
          <>
            {priceDiff > 0 ? (
              <TrendingUp className="w-4 h-4 text-purple-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-blue-400" />
            )}
            <span className="text-gray-400">
              YES price diff: <span className="text-white font-mono">{priceDiffPct.toFixed(1)}¢</span>
              {priceDiff > 0 ? ' (Poly higher)' : ' (Kalshi higher)'}
            </span>
          </>
        ) : (
          <>
            <Minus className="w-4 h-4 text-gray-500" />
            <span className="text-gray-500">Prices aligned</span>
          </>
        )}
      </div>
    </div>
  );
}

export default function PairsPage() {
  const [data, setData] = useState<PairsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState<string>('all');
  const [showOnlySpread, setShowOnlySpread] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      if (sportFilter !== 'all') params.set('sport', sportFilter);
      if (showOnlySpread) params.set('minSpread', '0.001');
      
      const res = await fetch(`/api/pairs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch pairs');
      
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [sportFilter, showOnlySpread]);

  const sports = data?.sports || [];

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Cross-Platform Pairs</h1>
            <p className="text-gray-400 text-sm mt-1">
              Same markets on Polymarket & Kalshi, side by side
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Sport:</label>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              className="bg-terminal-card border border-terminal-border rounded px-3 py-1.5 text-sm text-white"
            >
              <option value="all">All Sports</option>
              {sports.map(sport => (
                <option key={sport} value={sport}>{sport.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showOnlySpread}
              onChange={(e) => setShowOnlySpread(e.target.checked)}
              className="rounded border-terminal-border bg-terminal-card"
            />
            Only show pairs with spread opportunity
          </label>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-loss-low/10 border border-loss-low/30 flex items-center gap-3 text-loss-mid">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        {/* Results count */}
        {data && (
          <div className="mb-4 text-sm text-gray-400">
            Showing {data.pairs.length} matched pair{data.pairs.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Pairs grid */}
        {loading && !data ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-32 bg-terminal-hover rounded" />
              </div>
            ))}
          </div>
        ) : data?.pairs.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-gray-600 text-4xl mb-4">🔗</div>
            <h3 className="text-lg font-medium text-gray-400 mb-2">
              No Cross-Platform Pairs Found
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              Market pairs are discovered during sync for sports events (NFL, NBA, MLB, CFB).
              Make sure the sync job is running and there are upcoming games.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data?.pairs.map((pair) => (
              <PairCard key={pair.id} pair={pair} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
