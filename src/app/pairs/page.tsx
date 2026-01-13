'use client';

import { useEffect, useState, useMemo } from 'react';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, AlertCircle, TrendingUp, TrendingDown, Minus, ExternalLink, Check, X, Link2, Unlink, Search, ArrowDownWideNarrow, Zap, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';

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
  id: string;
  source: 'dome_api' | 'user_confirmed';
  category: 'sports' | 'elections' | 'other';
  sport?: string | null;
  gameDate?: string | null;
  matchConfidence: number;
  polymarket: MarketSide;
  kalshi: MarketSide;
  spread: {
    value: number | null;
    direction: string | null;
    priceDiff: number | null;
  };
  alignment?: {
    sidesInverted: boolean;
    polyTeam1: string | null;
    kalshiTeam1: string | null;
  };
  // Flag for markets with extreme prices (essentially resolved)
  hasExtremePrice?: boolean;
  extremePriceDetails?: {
    polyExtreme: boolean;
    kalshiExtreme: boolean;
  } | null;
}

interface KalshiCandidate {
  id: number;
  platformId: string;
  title: string;
  yesPrice: number;
  volume: number;
  score: number;
}

interface Suggestion {
  polyMarket: {
    id: number;
    platformId: string;
    title: string;
    yesPrice: number;
    volume: number;
  };
  kalshiCandidates: KalshiCandidate[];
}

interface PairsResponse {
  pairs: Pair[];
  total: number;
  resolvedHidden: number;
  sports: string[];
  categories: string[];
}

interface SuggestionsStats {
  polyElectionMarkets: number;
  kalshiElectionMarkets: number;
  suggestionsFound: number;
  alreadyConfirmed: number;
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

function PairCard({ pair, onUnlink }: { pair: Pair; onUnlink?: () => void }) {
  // Use aligned prices for comparison (Kalshi may be inverted)
  const sidesInverted = pair.alignment?.sidesInverted || false;
  const effectiveKalshiYes = sidesInverted ? pair.kalshi.noPrice : pair.kalshi.yesPrice;
  const effectiveKalshiNo = sidesInverted ? pair.kalshi.yesPrice : pair.kalshi.noPrice;
  
  const priceDiff = pair.polymarket.yesPrice - effectiveKalshiYes;
  const priceDiffPct = Math.abs(priceDiff) * 100;
  
  // Determine which side has better prices (using aligned prices)
  const polyYesCheaper = pair.polymarket.yesPrice < effectiveKalshiYes;
  const polyNoCheaper = pair.polymarket.noPrice < effectiveKalshiNo;
  
  const hasSpread = pair.spread.value !== null && pair.spread.value > 0;
  const isUserLinked = pair.source === 'user_confirmed';
  const hasExtremePrice = pair.hasExtremePrice || false;
  const polyExtreme = pair.extremePriceDetails?.polyExtreme || false;
  const kalshiExtreme = pair.extremePriceDetails?.kalshiExtreme || false;
  
  return (
    <div className={cn(
      'card p-4',
      hasSpread && !hasExtremePrice && 'border-profit-low',
      hasExtremePrice && 'border-yellow-500/50 opacity-60',
      isUserLinked && !hasExtremePrice && 'border-purple-500/30'
    )}>
      {/* Extreme price warning banner */}
      {hasExtremePrice && (
        <div className="mb-3 p-2 rounded bg-yellow-500/10 border border-yellow-500/30 flex items-center gap-2 text-yellow-400 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {polyExtreme && kalshiExtreme 
              ? 'Both markets have extreme prices (likely resolved)'
              : polyExtreme 
                ? 'Polymarket has extreme price (likely resolved)'
                : 'Kalshi has extreme price (likely resolved)'}
          </span>
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {pair.sport && (
              <span className="text-xs font-medium text-accent-cyan uppercase tracking-wider">
                {pair.sport.toUpperCase()}
              </span>
            )}
            {pair.category === 'elections' && (
              <span className="text-xs font-medium text-purple-400 uppercase tracking-wider">
                🗳️ ELECTION
              </span>
            )}
            {pair.gameDate && (
              <span className="text-xs text-gray-500">
                {new Date(pair.gameDate).toLocaleDateString()}
              </span>
            )}
            {sidesInverted && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                ⟳ Sides aligned
              </span>
            )}
            {isUserLinked && (
              <span className="text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-400">
                User Linked
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasSpread && !hasExtremePrice && (
            <div className="flex items-center gap-1 px-2 py-1 rounded bg-profit-low/20 text-profit-mid text-sm font-medium">
              <TrendingUp className="w-3 h-3" />
              {formatPercent(pair.spread.value! * 100)} spread
            </div>
          )}
          {isUserLinked && onUnlink && (
            <button
              onClick={onUnlink}
              className="p-1.5 rounded text-gray-500 hover:text-loss-mid hover:bg-loss-low/20 transition-colors"
              title="Remove link"
            >
              <Unlink className="w-4 h-4" />
            </button>
          )}
        </div>
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
              label={sidesInverted ? "YES (≈Poly NO)" : "YES"}
              highlight={sidesInverted ? (!polyNoCheaper ? 'low' : null) : (!polyYesCheaper ? 'low' : null)}
            />
            <PriceCell 
              price={pair.kalshi.noPrice} 
              label={sidesInverted ? "NO (≈Poly YES)" : "NO"}
              highlight={sidesInverted ? (!polyYesCheaper ? 'low' : null) : (!polyNoCheaper ? 'low' : null)}
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
              {sidesInverted ? 'Aligned ' : ''}YES price diff: <span className="text-white font-mono">{priceDiffPct.toFixed(1)}¢</span>
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

function SuggestionCard({ 
  suggestion, 
  onConfirm, 
  onReject,
  loading 
}: { 
  suggestion: Suggestion; 
  onConfirm: (kalshi: KalshiCandidate) => void;
  onReject: (kalshi: KalshiCandidate) => void;
  loading: boolean;
}) {
  const [selectedKalshi, setSelectedKalshi] = useState<number | null>(
    suggestion.kalshiCandidates[0]?.id || null
  );

  const selected = suggestion.kalshiCandidates.find(k => k.id === selectedKalshi);

  return (
    <div className="card p-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Polymarket side */}
        <div className="bg-terminal-bg rounded-lg p-4 border border-purple-500/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-purple-400">POLYMARKET</span>
            <a
              href={`https://polymarket.com/event/${suggestion.polyMarket.platformId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-500 hover:text-white"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <h3 className="text-white font-medium mb-3 line-clamp-2">
            {suggestion.polyMarket.title}
          </h3>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">
              YES: <span className="text-green-400 font-mono">{formatPrice(suggestion.polyMarket.yesPrice)}</span>
            </span>
            <span className="text-gray-500">
              Vol: {formatCurrency(suggestion.polyMarket.volume, 0)}
            </span>
          </div>
        </div>

        {/* Kalshi candidates */}
        <div className="bg-terminal-bg rounded-lg p-4 border border-blue-500/30">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-400">KALSHI MATCHES</span>
          </div>
          
          <div className="space-y-2 mb-3">
            {suggestion.kalshiCandidates.map((kalshi) => (
              <label
                key={kalshi.id}
                className={`flex items-start gap-3 p-2 rounded cursor-pointer transition-colors ${
                  selectedKalshi === kalshi.id 
                    ? 'bg-blue-500/20 border border-blue-500/50' 
                    : 'hover:bg-terminal-hover'
                }`}
              >
                <input
                  type="radio"
                  name={`kalshi-${suggestion.polyMarket.id}`}
                  checked={selectedKalshi === kalshi.id}
                  onChange={() => setSelectedKalshi(kalshi.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-accent-cyan/20 text-accent-cyan font-mono">
                      {kalshi.score}%
                    </span>
                    <span className="text-sm text-white truncate">{kalshi.title}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                    <span>YES: <span className="text-green-400">{formatPrice(kalshi.yesPrice)}</span></span>
                    <span>Vol: {formatCurrency(kalshi.volume, 0)}</span>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-terminal-border">
            <button
              onClick={() => selected && onConfirm(selected)}
              disabled={!selected || loading}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded bg-profit-low/20 text-profit-mid hover:bg-profit-low/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Check className="w-4 h-4" />
              Confirm Link
            </button>
            <button
              onClick={() => selected && onReject(selected)}
              disabled={!selected || loading}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded bg-loss-low/20 text-loss-mid hover:bg-loss-low/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <X className="w-4 h-4" />
              Not a Match
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type ViewMode = 'all' | 'sports' | 'elections' | 'link-markets';
type SortOption = 'priceDiff' | 'volume' | 'recent';

export default function PairsPage() {
  const [data, setData] = useState<PairsResponse | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsStats, setSuggestionsStats] = useState<SuggestionsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [sportFilter, setSportFilter] = useState<string>('all');
  const [showOnlySpread, setShowOnlySpread] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('priceDiff');

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch confirmed pairs
      const params = new URLSearchParams();
      params.set('view', 'confirmed');
      if (sportFilter !== 'all') params.set('sport', sportFilter);
      if (showOnlySpread) params.set('minSpread', '0.001');
      if (showResolved) params.set('hideResolved', 'false');
      
      const [pairsRes, suggestionsRes] = await Promise.all([
        fetch(`/api/pairs?${params}`),
        fetch('/api/pairs?view=suggestions&minScore=80'),
      ]);
      
      if (!pairsRes.ok) throw new Error('Failed to fetch pairs');
      
      const pairsJson = await pairsRes.json();
      setData(pairsJson);
      
      if (suggestionsRes.ok) {
        const suggestionsJson = await suggestionsRes.json();
        setSuggestions(suggestionsJson.suggestions || []);
        setSuggestionsStats(suggestionsJson.stats || null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [sportFilter, showOnlySpread, showResolved]);

  const handleConfirm = async (poly: Suggestion['polyMarket'], kalshi: KalshiCandidate) => {
    setActionLoading(true);
    try {
      await fetch('/api/pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm',
          polyMarketId: poly.id,
          kalshiMarketId: kalshi.id,
          polyTitle: poly.title,
          kalshiTitle: kalshi.title,
          matchScore: kalshi.score,
        }),
      });
      // Remove from suggestions
      setSuggestions(prev => prev.filter(s => s.polyMarket.id !== poly.id));
      // Refresh data
      fetchData();
    } catch (err) {
      console.error('Failed to confirm:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (poly: Suggestion['polyMarket'], kalshi: KalshiCandidate) => {
    setActionLoading(true);
    try {
      await fetch('/api/pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          polyMarketId: poly.id,
          kalshiMarketId: kalshi.id,
          polyTitle: poly.title,
          kalshiTitle: kalshi.title,
          matchScore: kalshi.score,
        }),
      });
      // Remove the rejected candidate from the suggestion
      setSuggestions(prev => prev.map(s => {
        if (s.polyMarket.id === poly.id) {
          const remaining = s.kalshiCandidates.filter(k => k.id !== kalshi.id);
          if (remaining.length === 0) return null as any;
          return { ...s, kalshiCandidates: remaining };
        }
        return s;
      }).filter(Boolean));
    } catch (err) {
      console.error('Failed to reject:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlink = async (pair: Pair) => {
    setActionLoading(true);
    try {
      await fetch('/api/pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unlink',
          polyMarketId: pair.polymarket.id,
          kalshiMarketId: pair.kalshi.id,
        }),
      });
      fetchData();
    } catch (err) {
      console.error('Failed to unlink:', err);
    } finally {
      setActionLoading(false);
    }
  };

  // Filter and sort pairs
  const filteredPairs = useMemo(() => {
    if (!data?.pairs) return [];
    
    let pairs = data.pairs;
    
    // Filter by view mode
    if (viewMode === 'sports') {
      pairs = pairs.filter(p => p.category === 'sports');
    } else if (viewMode === 'elections') {
      pairs = pairs.filter(p => p.category === 'elections');
    }
    
    // Sort
    switch (sortBy) {
      case 'priceDiff':
        return pairs.sort((a, b) => (b.spread.priceDiff || 0) - (a.spread.priceDiff || 0));
      case 'volume':
        return pairs.sort((a, b) => 
          Math.max(b.polymarket.volume24h, b.kalshi.volume24h) - 
          Math.max(a.polymarket.volume24h, a.kalshi.volume24h)
        );
      case 'recent':
      default:
        return pairs;
    }
  }, [data?.pairs, viewMode, sortBy]);

  const sports = data?.sports || [];
  const sportsPairsCount = data?.pairs.filter(p => p.category === 'sports').length || 0;
  const electionPairsCount = data?.pairs.filter(p => p.category === 'elections').length || 0;

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

        {/* View Mode Tabs */}
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          <button
            onClick={() => setViewMode('all')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              viewMode === 'all'
                ? 'bg-accent-cyan/20 text-accent-cyan'
                : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
            )}
          >
            All Pairs ({data?.pairs.length || 0})
          </button>
          <button
            onClick={() => setViewMode('sports')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              viewMode === 'sports'
                ? 'bg-accent-cyan/20 text-accent-cyan'
                : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
            )}
          >
            🏈 Sports ({sportsPairsCount})
          </button>
          <button
            onClick={() => setViewMode('elections')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors',
              viewMode === 'elections'
                ? 'bg-purple-500/20 text-purple-400'
                : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
            )}
          >
            🗳️ Elections ({electionPairsCount})
          </button>
          <div className="w-px h-6 bg-terminal-border" />
          <button
            onClick={() => setViewMode('link-markets')}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2',
              viewMode === 'link-markets'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
            )}
          >
            <Link2 className="w-4 h-4" />
            Link Markets ({suggestions.length})
          </button>
        </div>

        {/* Filters (only for pairs view) */}
        {viewMode !== 'link-markets' && (
          <div className="flex items-center gap-4 mb-6 flex-wrap">
            {viewMode === 'sports' && sports.length > 0 && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-400">Sport:</label>
                <select
                  value={sportFilter}
                  onChange={(e) => setSportFilter(e.target.value)}
                  className="bg-terminal-card border border-terminal-border rounded px-3 py-1.5 text-sm text-white"
                >
                  <option value="all">All Sports</option>
                  {sports.map(sport => (
                    <option key={sport} value={sport}>{sport?.toUpperCase()}</option>
                  ))}
                </select>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showOnlySpread}
                onChange={(e) => setShowOnlySpread(e.target.checked)}
                className="rounded border-terminal-border bg-terminal-card"
              />
              Only show pairs with spread opportunity
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
                className="rounded border-terminal-border bg-terminal-card"
              />
              Show resolved/past games
              {!showResolved && data?.resolvedHidden && data.resolvedHidden > 0 && (
                <span className="text-xs text-gray-500">({data.resolvedHidden} hidden)</span>
              )}
            </label>
            <div className="flex items-center gap-2 ml-auto">
              <ArrowDownWideNarrow className="w-4 h-4 text-gray-500" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="bg-terminal-card border border-terminal-border rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-accent-cyan"
              >
                <option value="priceDiff">Price Difference</option>
                <option value="volume">Volume</option>
                <option value="recent">Most Recent</option>
              </select>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-loss-low/10 border border-loss-low/30 flex items-center gap-3 text-loss-mid">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        {/* Link Markets View */}
        {viewMode === 'link-markets' && (
          <>
            {/* Stats */}
            {suggestionsStats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="card p-3 text-center">
                  <div className="text-xl font-bold text-purple-400">{suggestionsStats.polyElectionMarkets}</div>
                  <div className="text-xs text-gray-500">Poly Election Markets</div>
                </div>
                <div className="card p-3 text-center">
                  <div className="text-xl font-bold text-blue-400">{suggestionsStats.kalshiElectionMarkets}</div>
                  <div className="text-xs text-gray-500">Kalshi Election Markets</div>
                </div>
                <div className="card p-3 text-center">
                  <div className="text-xl font-bold text-accent-cyan">{suggestionsStats.suggestionsFound}</div>
                  <div className="text-xs text-gray-500">Potential Matches</div>
                </div>
                <div className="card p-3 text-center">
                  <div className="text-xl font-bold text-profit-mid">{suggestionsStats.alreadyConfirmed}</div>
                  <div className="text-xs text-gray-500">Already Linked</div>
                </div>
              </div>
            )}
            
            {loading ? (
              <div className="space-y-4">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="card p-4 animate-pulse">
                    <div className="h-24 bg-terminal-hover rounded" />
                  </div>
                ))}
              </div>
            ) : suggestions.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="text-4xl mb-4">🎉</div>
                <h3 className="text-lg font-medium text-gray-400 mb-2">
                  No More Suggestions
                </h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  All high-confidence election market matches have been reviewed. 
                  New suggestions will appear as markets are added.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400 mb-2">
                  Review and confirm matching election markets between platforms:
                </p>
                {suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.polyMarket.id}
                    suggestion={suggestion}
                    onConfirm={(kalshi) => handleConfirm(suggestion.polyMarket, kalshi)}
                    onReject={(kalshi) => handleReject(suggestion.polyMarket, kalshi)}
                    loading={actionLoading}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Pairs View */}
        {viewMode !== 'link-markets' && (
          <>
            {/* Results count */}
            {data && (
              <div className="mb-4 text-sm text-gray-400">
                Showing {filteredPairs.length} matched pair{filteredPairs.length !== 1 ? 's' : ''}
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
            ) : filteredPairs.length === 0 ? (
              <div className="card p-8 text-center">
                <div className="text-gray-600 text-4xl mb-4">🔗</div>
                <h3 className="text-lg font-medium text-gray-400 mb-2">
                  No Cross-Platform Pairs Found
                </h3>
                <p className="text-sm text-gray-500 max-w-md mx-auto">
                  {viewMode === 'elections' 
                    ? 'No election market pairs linked yet. Use the "Link Markets" tab to connect matching markets.'
                    : 'Market pairs are discovered during sync for sports events. Make sure the sync job is running.'}
                </p>
                {viewMode === 'elections' && (
                  <button
                    onClick={() => setViewMode('link-markets')}
                    className="mt-4 px-4 py-2 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors"
                  >
                    <Link2 className="w-4 h-4 inline mr-2" />
                    Link Election Markets
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredPairs.map((pair) => (
                  <PairCard 
                    key={pair.id} 
                    pair={pair}
                    onUnlink={pair.source === 'user_confirmed' ? () => handleUnlink(pair) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Info */}
        <div className="mt-8 text-sm text-gray-500">
          <p>
            Sports markets are auto-matched via Dome API. Election markets can be manually linked 
            using the "Link Markets" tab. Linked pairs enable cross-platform price comparison and arbitrage detection.
          </p>
        </div>
      </main>
    </div>
  );
}
