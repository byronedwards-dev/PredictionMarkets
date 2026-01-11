'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, Check, X, Link2, Unlink, Search, ExternalLink } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

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

interface ConfirmedLink {
  id: number;
  polyMarketId: number;
  kalshiMarketId: number;
  polyTitle: string;
  kalshiTitle: string;
  matchScore: number;
  polyYesPrice: number;
  kalshiYesPrice: number;
  polyVolume: number;
  kalshiVolume: number;
  confirmedAt: string;
}

interface Stats {
  polyElectionMarkets: number;
  kalshiElectionMarkets: number;
  suggestionsFound: number;
  alreadyConfirmed: number;
  minScoreThreshold: number;
}

function formatPrice(price: number): string {
  return `${(price * 100).toFixed(0)}¢`;
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

function ConfirmedCard({ 
  link, 
  onUnlink,
  loading 
}: { 
  link: ConfirmedLink; 
  onUnlink: () => void;
  loading: boolean;
}) {
  const priceDiff = Math.abs(link.polyYesPrice - link.kalshiYesPrice) * 100;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-4">
        {/* Link icon */}
        <div className="p-2 rounded-lg bg-profit-low/20">
          <Link2 className="w-5 h-5 text-profit-mid" />
        </div>

        {/* Markets */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Poly */}
            <div>
              <span className="text-xs text-purple-400 font-medium">POLYMARKET</span>
              <p className="text-sm text-white truncate" title={link.polyTitle}>
                {link.polyTitle}
              </p>
              <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                <span>YES: <span className="text-green-400 font-mono">{formatPrice(link.polyYesPrice)}</span></span>
                <span>Vol: {formatCurrency(link.polyVolume, 0)}</span>
              </div>
            </div>

            {/* Kalshi */}
            <div>
              <span className="text-xs text-blue-400 font-medium">KALSHI</span>
              <p className="text-sm text-white truncate" title={link.kalshiTitle}>
                {link.kalshiTitle}
              </p>
              <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
                <span>YES: <span className="text-green-400 font-mono">{formatPrice(link.kalshiYesPrice)}</span></span>
                <span>Vol: {formatCurrency(link.kalshiVolume, 0)}</span>
              </div>
            </div>
          </div>

          {/* Price diff */}
          {priceDiff > 1 && (
            <div className="mt-2 text-xs text-gray-400">
              Price difference: <span className="text-yellow-400 font-mono">{priceDiff.toFixed(1)}¢</span>
            </div>
          )}
        </div>

        {/* Unlink button */}
        <button
          onClick={onUnlink}
          disabled={loading}
          className="p-2 rounded text-gray-500 hover:text-loss-mid hover:bg-loss-low/20 transition-colors disabled:opacity-50"
          title="Remove link"
        >
          <Unlink className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const [view, setView] = useState<'suggestions' | 'confirmed'>('suggestions');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [confirmed, setConfirmed] = useState<ConfirmedLink[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (view === 'suggestions') {
        const res = await fetch('/api/discover?view=suggestions&minScore=80');
        const data = await res.json();
        setSuggestions(data.suggestions || []);
        setStats(data.stats || null);
      } else {
        const res = await fetch('/api/discover?view=confirmed');
        const data = await res.json();
        setConfirmed(data.links || []);
      }
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [view]);

  const handleConfirm = async (poly: Suggestion['polyMarket'], kalshi: KalshiCandidate) => {
    setActionLoading(true);
    try {
      await fetch('/api/discover', {
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
    } catch (err) {
      console.error('Failed to confirm:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (poly: Suggestion['polyMarket'], kalshi: KalshiCandidate) => {
    setActionLoading(true);
    try {
      await fetch('/api/discover', {
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
          if (remaining.length === 0) {
            return null as any; // Will filter out
          }
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

  const handleUnlink = async (link: ConfirmedLink) => {
    setActionLoading(true);
    try {
      await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'unlink',
          polyMarketId: link.polyMarketId,
          kalshiMarketId: link.kalshiMarketId,
        }),
      });
      // Remove from confirmed
      setConfirmed(prev => prev.filter(c => c.id !== link.id));
    } catch (err) {
      console.error('Failed to unlink:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-white flex items-center gap-3">
              <span className="text-2xl">🗳️</span>
              Discover Election Markets
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Link similar markets between Polymarket & Kalshi
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

        {/* Tabs */}
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => setView('suggestions')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'suggestions'
                ? 'bg-accent-cyan/20 text-accent-cyan'
                : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
            }`}
          >
            <Search className="w-4 h-4 inline mr-2" />
            Suggestions ({stats?.suggestionsFound || suggestions.length})
          </button>
          <button
            onClick={() => setView('confirmed')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              view === 'confirmed'
                ? 'bg-accent-cyan/20 text-accent-cyan'
                : 'text-gray-400 hover:text-white hover:bg-terminal-hover'
            }`}
          >
            <Link2 className="w-4 h-4 inline mr-2" />
            Confirmed Links ({confirmed.length || stats?.alreadyConfirmed || 0})
          </button>
        </div>

        {/* Stats */}
        {view === 'suggestions' && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="card p-3 text-center">
              <div className="text-xl font-bold text-purple-400">{stats.polyElectionMarkets}</div>
              <div className="text-xs text-gray-500">Poly Election Markets</div>
            </div>
            <div className="card p-3 text-center">
              <div className="text-xl font-bold text-blue-400">{stats.kalshiElectionMarkets}</div>
              <div className="text-xs text-gray-500">Kalshi Election Markets</div>
            </div>
            <div className="card p-3 text-center">
              <div className="text-xl font-bold text-accent-cyan">{stats.suggestionsFound}</div>
              <div className="text-xs text-gray-500">Potential Matches</div>
            </div>
            <div className="card p-3 text-center">
              <div className="text-xl font-bold text-profit-mid">{stats.alreadyConfirmed}</div>
              <div className="text-xs text-gray-500">Already Linked</div>
            </div>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-24 bg-terminal-hover rounded" />
              </div>
            ))}
          </div>
        ) : view === 'suggestions' ? (
          suggestions.length === 0 ? (
            <div className="card p-8 text-center">
              <div className="text-4xl mb-4">🎉</div>
              <h3 className="text-lg font-medium text-gray-400 mb-2">
                No More Suggestions
              </h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                All high-confidence matches have been reviewed. 
                Lower the threshold or wait for new markets to appear.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
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
          )
        ) : (
          confirmed.length === 0 ? (
            <div className="card p-8 text-center">
              <Link2 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-400 mb-2">
                No Confirmed Links Yet
              </h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                Go to the Suggestions tab to review and confirm market matches.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {confirmed.map((link) => (
                <ConfirmedCard
                  key={link.id}
                  link={link}
                  onUnlink={() => handleUnlink(link)}
                  loading={actionLoading}
                />
              ))}
            </div>
          )
        )}

        {/* Info */}
        <div className="mt-8 text-sm text-gray-500">
          <p>
            Markets are matched using fuzzy title comparison with an 80%+ confidence threshold.
            Confirmed links are saved and used for cross-platform price comparison.
          </p>
        </div>
      </main>
    </div>
  );
}
