'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { StatCard } from '@/components/StatCard';
import { ArbCard } from '@/components/ArbCard';
import { 
  TrendingUp, 
  Zap, 
  DollarSign, 
  Activity, 
  RefreshCcw,
  AlertCircle,
  Database,
  Layers
} from 'lucide-react';
import { formatCurrency, formatPercent, formatRelativeTime } from '@/lib/utils';

interface PlatformBreakdown {
  totalMarkets: number;
  totalEvents: number;
  singleOutcome: number;
  multiOutcome: number;
  marketsInMulti: number;
}

interface CategoryBreakdown {
  polymarket: number;
  kalshi: number;
  total: number;
}

interface Stats {
  markets: {
    total: number;
    polymarket: number;
    kalshi: number;
    withArb: number;
  };
  arbs: {
    active: number;
    executable: number;
    thin: number;
    theoretical: number;
    avgSpread: number;
    totalDeployable: number;
  };
  lastSync: {
    startedAt: string;
    completedAt: string;
    status: string;
    marketsSynced: number;
    arbsDetected: number;
  } | null;
  fees: {
    platform: string;
    takerFeePct: number;
    lastVerified: string | null;
  }[];
  snapshots: {
    total: number;
    today: number;
    backfill: number;
  };
  events: {
    total: number;
    active: number;
    closed: number;
  };
  platformBreakdown?: Record<string, PlatformBreakdown>;
  categories?: Record<string, CategoryBreakdown>;
}

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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [arbs, setArbs] = useState<Arb[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [statsRes, arbsRes] = await Promise.all([
        fetch('/api/stats'),
        fetch('/api/arbs?quality=executable,thin'),
      ]);
      
      if (!statsRes.ok || !arbsRes.ok) {
        throw new Error('Failed to fetch data');
      }
      
      const statsData = await statsRes.json();
      const arbsData = await arbsRes.json();
      
      setStats(statsData);
      setArbs(arbsData.arbs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">
              Real-time arbitrage detection across prediction markets
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

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-loss-low/10 border border-loss-low/30 flex items-center gap-3 text-loss-mid">
            <AlertCircle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard
            title="Total Markets"
            value={stats?.markets.total || 0}
            subtitle={`${stats?.markets.polymarket || 0} Poly · ${stats?.markets.kalshi || 0} Kalshi`}
            icon={TrendingUp}
            variant="accent"
          />
          <StatCard
            title="Events"
            value={stats?.events?.active || 0}
            subtitle={`${stats?.events?.closed || 0} closed · ${stats?.events?.total || 0} total`}
            icon={Layers}
            variant="accent"
          />
          <StatCard
            title="Data Points"
            value={(stats?.snapshots?.total || 0).toLocaleString()}
            subtitle={`+${(stats?.snapshots?.today || 0).toLocaleString()} today`}
            icon={Database}
            variant="accent"
          />
          <StatCard
            title="Active Arbs"
            value={stats?.arbs.active || 0}
            subtitle={`${stats?.arbs.executable || 0} executable · ${stats?.arbs.thin || 0} thin`}
            icon={Zap}
            variant={stats?.arbs.executable ? 'profit' : 'default'}
          />
          <StatCard
            title="Total Deployable"
            value={formatCurrency(stats?.arbs.totalDeployable || 0, 0)}
            subtitle={`Avg spread: ${formatPercent(stats?.arbs.avgSpread || 0)}`}
            icon={DollarSign}
            variant="profit"
          />
          <StatCard
            title="Last Sync"
            value={stats?.lastSync?.completedAt 
              ? formatRelativeTime(new Date(stats.lastSync.completedAt)) 
              : stats?.lastSync?.startedAt 
                ? 'Running...'
                : 'Never'}
            subtitle={stats?.lastSync 
              ? `${stats.lastSync.marketsSynced} markets synced` 
              : 'Run sync job to start'}
            icon={Activity}
            variant={stats?.lastSync?.status === 'completed' ? 'default' : 'warning'}
          />
        </div>

        {/* Fee Configuration Alert */}
        {stats?.fees && stats.fees.length > 0 && (
          <div className="mb-6 p-4 rounded-lg bg-terminal-card border border-terminal-border">
            <h3 className="text-sm font-medium text-gray-400 mb-2">Current Fee Configuration</h3>
            <div className="flex gap-6 text-sm">
              {stats.fees.map((fee) => (
                <div key={fee.platform} className="flex items-center gap-2">
                  <span className={fee.platform === 'polymarket' ? 'text-purple-400' : 'text-blue-400'}>
                    {fee.platform}:
                  </span>
                  <span className="font-mono text-white">{(fee.takerFeePct * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Platform Breakdown */}
        {stats?.platformBreakdown && Object.keys(stats.platformBreakdown).length > 0 && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(stats.platformBreakdown).map(([platform, data]) => (
              <div key={platform} className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-2 h-2 rounded-full ${platform === 'polymarket' ? 'bg-purple-400' : 'bg-blue-400'}`} />
                  <h3 className="text-sm font-medium text-white capitalize">{platform}</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Total Markets</p>
                    <p className="text-xl font-mono text-white">{data.totalMarkets.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Events</p>
                    <p className="text-xl font-mono text-white">{data.totalEvents.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Single Outcome</p>
                    <p className="text-lg font-mono text-gray-300">{data.singleOutcome.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Multi-Outcome</p>
                    <p className="text-lg font-mono text-profit-mid">
                      {data.multiOutcome.toLocaleString()}
                      <span className="text-xs text-gray-500 ml-1">({data.marketsInMulti} markets)</span>
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Category Breakdown */}
        {stats?.categories && Object.keys(stats.categories).length > 0 && (
          <div className="mb-6 p-4 rounded-lg bg-terminal-card border border-terminal-border">
            <h3 className="text-sm font-medium text-gray-400 mb-3">Markets by Category</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {Object.entries(stats.categories)
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([category, data]) => (
                  <div key={category} className="p-3 rounded bg-terminal-hover">
                    <p className="text-sm font-medium text-white mb-1">{category}</p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-purple-400">{data.polymarket}</span>
                      <span className="text-gray-600">/</span>
                      <span className="text-blue-400">{data.kalshi}</span>
                      <span className="text-gray-500 ml-auto">{data.total} total</span>
                    </div>
                  </div>
                ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              <span className="text-purple-400">Purple</span> = Polymarket · <span className="text-blue-400">Blue</span> = Kalshi
            </p>
          </div>
        )}

        {/* Arb Opportunities */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-white">
              Active Opportunities
            </h2>
            <span className="text-sm text-gray-400">
              Showing executable and thin arbs
            </span>
          </div>
          
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
                No Active Arbitrage Opportunities
              </h3>
              <p className="text-sm text-gray-500 max-w-md mx-auto">
                The scanner is monitoring markets in real-time. Opportunities will appear here 
                when detected. Make sure the sync job is running.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {arbs.map((arb) => (
                <ArbCard key={arb.id} arb={arb} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
