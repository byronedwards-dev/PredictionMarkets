'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { ArbCard } from '@/components/ArbCard';
import { StatCard } from '@/components/StatCard';
import { RefreshCcw, Filter, Zap, DollarSign, TrendingUp } from 'lucide-react';
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
  poly_title?: string;
  kalshi_title?: string;
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

export default function ArbsPage() {
  const [arbs, setArbs] = useState<Arb[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    type: '',
    quality: [] as string[],
    minSpread: '',
    minDeployable: '',
  });

  const fetchArbs = () => {
    // Trigger refresh by forcing a filter state update
    setFilters(f => ({ ...f }));
  };

  useEffect(() => {
    const doFetch = async () => {
      try {
        setLoading(true);
        
        const params = new URLSearchParams();
        if (filters.type) params.set('type', filters.type);
        if (filters.quality.length > 0) params.set('quality', filters.quality.join(','));
        if (filters.minSpread) params.set('minSpread', filters.minSpread);
        if (filters.minDeployable) params.set('minDeployable', filters.minDeployable);
        
        const res = await fetch(`/api/arbs?${params}`);
        const data = await res.json();
        
        setArbs(data.arbs || []);
        setStats(data.stats || null);
      } catch (err) {
        console.error('Failed to fetch arbs:', err);
      } finally {
        setLoading(false);
      }
    };
    
    doFetch();
    
    // Refresh every 30 seconds
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

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Arbitrage Opportunities</h1>
            <p className="text-gray-400 text-sm mt-1">
              Real-time detection with fee-adjusted calculations
            </p>
          </div>
          <button
            onClick={fetchArbs}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <StatCard
              title="Active Arbs"
              value={stats.total}
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
                onClick={() => setFilters({ ...filters, type: '' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  !filters.type
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilters({ ...filters, type: 'underround' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  filters.type === 'underround'
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                Single Market
              </button>
              <button
                onClick={() => setFilters({ ...filters, type: 'cross_platform' })}
                className={cn(
                  'px-3 py-1.5 rounded text-xs font-medium transition-all',
                  filters.type === 'cross_platform'
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-terminal-hover text-gray-400 hover:text-white'
                )}
              >
                Cross-Platform
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

            {/* Min deployable */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Min Deploy:</span>
              <select
                value={filters.minDeployable}
                onChange={(e) => setFilters({ ...filters, minDeployable: e.target.value })}
                className="px-3 py-1.5 rounded bg-terminal-bg border border-terminal-border text-white text-xs focus:outline-none focus:border-accent-cyan"
              >
                <option value="">Any</option>
                <option value="100">$100+</option>
                <option value="500">$500+</option>
                <option value="1000">$1,000+</option>
              </select>
            </div>
          </div>
        </div>

        {/* Arb List */}
        {loading && arbs.length === 0 ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-20 bg-terminal-hover rounded" />
              </div>
            ))}
          </div>
        ) : arbs.length === 0 ? (
          <div className="card p-8 text-center">
            <Zap className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-400 mb-2">
              No Arbitrage Opportunities Found
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              {filters.quality.length > 0 || filters.minSpread || filters.minDeployable
                ? 'Try adjusting your filters to see more opportunities.'
                : 'The scanner is actively monitoring. Opportunities will appear when detected.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {arbs.map((arb) => (
              <ArbCard key={arb.id} arb={arb} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
