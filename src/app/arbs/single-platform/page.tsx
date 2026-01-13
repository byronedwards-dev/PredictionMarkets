'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { SinglePlatformArbCard } from '@/components/SinglePlatformArbCard';
import { StatCard } from '@/components/StatCard';
import { SyncButton } from '@/components/SyncButton';
import { RefreshCcw, Zap, DollarSign, TrendingUp, Layers } from 'lucide-react';
import { cn, formatCurrency, formatPercent } from '@/lib/utils';

interface Arb {
  id: number;
  type: string;
  quality: 'executable' | 'thin' | 'theoretical';
  gross_spread_pct: string;
  total_fees_pct: string;
  net_spread_pct: string;
  max_deployable_usd: string;
  capital_weighted_spread: string;
  detected_at: string;
  last_seen_at: string;
  snapshot_count: number;
  duration_seconds: number;
  market_title?: string;
  platform?: string;
  details: Record<string, unknown>;
}

interface Stats {
  total: number;
  executable: number;
  thin: number;
  theoretical: number;
  avgSpread: number;
  totalDeployable: number;
}

export default function SinglePlatformArbsPage() {
  const [arbs, setArbs] = useState<Arb[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    subType: '' as '' | 'underround' | 'multi_outcome',
    quality: [] as string[],
    platform: '' as '' | 'polymarket' | 'kalshi',
    minSpread: '',
    minDeployable: '',
  });

  const fetchArbs = () => {
    setFilters(f => ({ ...f }));
  };

  useEffect(() => {
    const doFetch = async () => {
      try {
        setLoading(true);
        
        // Fetch single-platform arbs (underround + multi_outcome)
        const params = new URLSearchParams();
        if (filters.subType) {
          params.set('type', filters.subType);
        } else {
          // Fetch both types
          params.set('type', 'underround,multi_outcome');
        }
        if (filters.quality.length > 0) params.set('quality', filters.quality.join(','));
        if (filters.minSpread) params.set('minSpread', filters.minSpread);
        if (filters.minDeployable) params.set('minDeployable', filters.minDeployable);
        
        const res = await fetch(`/api/arbs?${params}`);
        const data = await res.json();
        
        let filteredArbs = data.arbs || [];
        
        // Filter by platform if specified
        if (filters.platform) {
          filteredArbs = filteredArbs.filter((a: Arb) => 
            a.platform === filters.platform || 
            (a.details?.platform as string) === filters.platform
          );
        }
        
        setArbs(filteredArbs);
        
        // Calculate stats from filtered data
        const underroundCount = filteredArbs.filter((a: Arb) => a.type === 'underround').length;
        const multiCount = filteredArbs.filter((a: Arb) => a.type === 'multi_outcome').length;
        
        setStats({
          total: filteredArbs.length,
          executable: filteredArbs.filter((a: Arb) => a.quality === 'executable').length,
          thin: filteredArbs.filter((a: Arb) => a.quality === 'thin').length,
          theoretical: filteredArbs.filter((a: Arb) => a.quality === 'theoretical').length,
          avgSpread: filteredArbs.length > 0 
            ? filteredArbs.reduce((sum: number, a: Arb) => sum + parseFloat(a.net_spread_pct), 0) / filteredArbs.length 
            : 0,
          totalDeployable: filteredArbs.reduce((sum: number, a: Arb) => sum + parseFloat(a.max_deployable_usd), 0),
        });
      } catch (err) {
        console.error('Failed to fetch arbs:', err);
      } finally {
        setLoading(false);
      }
    };
    
    doFetch();
    
    const interval = setInterval(doFetch, 30000);
    return () => clearInterval(interval);
  }, [filters]);

  const toggleQuality = (q: string) => {
    setFilters((prev) => ({
      ...prev,
      quality: prev.quality.includes(q)
        ? prev.quality.filter((x) => x !== q)
        : [...prev.quality, q],
    }));
  };

  const underroundCount = arbs.filter(a => a.type === 'underround').length;
  const multiCount = arbs.filter(a => a.type === 'multi_outcome').length;

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Single-Platform Arbitrage</h1>
            <p className="text-gray-400 text-sm mt-1">
              Underround & multi-outcome opportunities on individual platforms
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SyncButton onSyncComplete={fetchArbs} />
            <button
              onClick={fetchArbs}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all disabled:opacity-50"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            <StatCard
              title="Total Arbs"
              value={stats.total}
              subtitle={`${underroundCount} under · ${multiCount} multi`}
              icon={Zap}
              variant="accent"
            />
            <StatCard
              title="Executable"
              value={stats.executable}
              icon={TrendingUp}
              variant={stats.executable > 0 ? 'profit' : 'default'}
            />
            <StatCard
              title="Thin"
              value={stats.thin}
              variant="warning"
            />
            <StatCard
              title="Total Deployable"
              value={formatCurrency(stats.totalDeployable, 0)}
              icon={DollarSign}
              variant="profit"
            />
            <StatCard
              title="Avg Net Spread"
              value={formatPercent(stats.avgSpread)}
              variant={stats.avgSpread >= 2 ? 'profit' : 'warning'}
            />
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 p-4 rounded-lg bg-terminal-card border border-terminal-border">
          <div className="flex flex-wrap items-center gap-4">
            {/* Type filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Type:</span>
              <button
                onClick={() => setFilters({ ...filters, subType: '' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  !filters.subType
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                All ({arbs.length})
              </button>
              <button
                onClick={() => setFilters({ ...filters, subType: 'underround' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  filters.subType === 'underround'
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                Underround ({underroundCount})
              </button>
              <button
                onClick={() => setFilters({ ...filters, subType: 'multi_outcome' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-1',
                  filters.subType === 'multi_outcome'
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                <Layers className="w-3 h-3" />
                Multi-Outcome ({multiCount})
              </button>
            </div>

            <div className="w-px h-6 bg-terminal-border" />

            {/* Platform filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Platform:</span>
              <button
                onClick={() => setFilters({ ...filters, platform: '' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  !filters.platform
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilters({ ...filters, platform: 'polymarket' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  filters.platform === 'polymarket'
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                Polymarket
              </button>
              <button
                onClick={() => setFilters({ ...filters, platform: 'kalshi' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  filters.platform === 'kalshi'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                Kalshi
              </button>
            </div>

            <div className="w-px h-6 bg-terminal-border" />

            {/* Quality filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Quality:</span>
              {['executable', 'thin', 'theoretical'].map((q) => (
                <button
                  key={q}
                  onClick={() => toggleQuality(q)}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs font-medium transition-all border',
                    filters.quality.includes(q)
                      ? q === 'executable'
                        ? 'bg-profit-low/20 text-profit-low border-profit-low/30'
                        : q === 'thin'
                        ? 'bg-accent-amber/20 text-accent-amber border-accent-amber/30'
                        : 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                      : 'bg-terminal-hover text-gray-500 border-transparent hover:text-white'
                  )}
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-terminal-border" />

            {/* Min spread */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Min Spread:</span>
              <select
                value={filters.minSpread}
                onChange={(e) => setFilters({ ...filters, minSpread: e.target.value })}
                className="px-3 py-1.5 rounded bg-terminal-bg border border-terminal-border text-white text-xs focus:outline-none focus:border-accent-cyan"
              >
                <option value="">Any</option>
                <option value="2">2%+</option>
                <option value="3">3%+</option>
                <option value="5">5%+</option>
              </select>
            </div>
          </div>
        </div>

        {/* Explanation */}
        <div className="mb-6 p-3 rounded-lg bg-terminal-card/50 border border-terminal-border text-sm text-gray-400">
          <strong className="text-white">How it works:</strong> Single-platform arbs occur when you can buy both sides 
          (YES + NO) or all outcomes for less than the guaranteed $1 payout. The "sum" shown on each card is the total 
          cost to execute the strategy.
        </div>

        {/* Arb List */}
        {loading && arbs.length === 0 ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-32 bg-terminal-hover rounded" />
              </div>
            ))}
          </div>
        ) : arbs.length === 0 ? (
          <div className="card p-8 text-center">
            <Zap className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-400 mb-2">
              No Single-Platform Arbs Found
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              {filters.quality.length > 0 || filters.minSpread || filters.platform
                ? 'Try adjusting your filters to see more opportunities.'
                : 'Underround and multi-outcome opportunities will appear here when detected.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {arbs.map((arb) => (
              <SinglePlatformArbCard key={arb.id} arb={arb} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
