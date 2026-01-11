'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, Activity, TrendingUp, AlertTriangle, Clock, ArrowUp, ExternalLink } from 'lucide-react';
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils';

interface VolumeAlert {
  id: number;
  marketId: number;
  title: string;
  platform: string;
  volumeUsd: number;
  rollingAvg: number;
  multiplier: number;
  zScore: number;
  alertedAt: string;
}

interface Summary {
  totalAlerts: number;
  avgMultiplier: number;
  maxMultiplier: number;
  uniqueMarkets: number;
}

export default function VolumePage() {
  const [alerts, setAlerts] = useState<VolumeAlert[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [minMultiplier, setMinMultiplier] = useState(1.5);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/volume-alerts?hours=${hours}&minMultiplier=${minMultiplier}`
      );
      const data = await response.json();
      setAlerts(data.alerts || []);
      setSummary(data.summary || null);
    } catch (err) {
      console.error('Failed to fetch volume alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [hours, minMultiplier]);

  const getMultiplierColor = (mult: number) => {
    if (mult >= 5) return 'text-red-400 bg-red-500/20';
    if (mult >= 3) return 'text-orange-400 bg-orange-500/20';
    if (mult >= 2) return 'text-yellow-400 bg-yellow-500/20';
    return 'text-green-400 bg-green-500/20';
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Volume Alerts</h1>
            <p className="text-gray-400 text-sm mt-1">
              Candlestick-based detection of unusual trading activity (via Dome API)
            </p>
          </div>
          <button
            onClick={fetchAlerts}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="card mb-6">
          <div className="card-body">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-400" />
                <select
                  value={hours}
                  onChange={(e) => setHours(parseInt(e.target.value))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm text-gray-200"
                >
                  <option value={6}>Last 6 hours</option>
                  <option value={12}>Last 12 hours</option>
                  <option value={24}>Last 24 hours</option>
                  <option value={48}>Last 48 hours</option>
                  <option value={168}>Last 7 days</option>
                </select>
              </div>
              
              <div className="flex items-center gap-2">
                <ArrowUp className="h-4 w-4 text-gray-400" />
                <select
                  value={minMultiplier}
                  onChange={(e) => setMinMultiplier(parseFloat(e.target.value))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm text-gray-200"
                >
                  <option value={1.5}>1.5x+ avg volume</option>
                  <option value={2}>2x+ avg volume</option>
                  <option value={3}>3x+ avg volume</option>
                  <option value={5}>5x+ avg volume</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && summary.totalAlerts > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="card">
              <div className="card-body text-center">
                <div className="text-2xl font-bold text-yellow-400">
                  {summary.totalAlerts}
                </div>
                <div className="text-sm text-gray-400">Total Alerts</div>
              </div>
            </div>
            <div className="card">
              <div className="card-body text-center">
                <div className="text-2xl font-bold text-orange-400">
                  {summary.maxMultiplier.toFixed(1)}x
                </div>
                <div className="text-sm text-gray-400">Max Spike</div>
              </div>
            </div>
            <div className="card">
              <div className="card-body text-center">
                <div className="text-2xl font-bold text-accent-cyan">
                  {summary.avgMultiplier.toFixed(1)}x
                </div>
                <div className="text-sm text-gray-400">Avg Multiplier</div>
              </div>
            </div>
            <div className="card">
              <div className="card-body text-center">
                <div className="text-2xl font-bold text-green-400">
                  {summary.uniqueMarkets}
                </div>
                <div className="text-sm text-gray-400">Unique Markets</div>
              </div>
            </div>
          </div>
        )}

        {/* Info Card */}
        <div className="card mb-8">
          <div className="card-body">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-accent-amber/10">
                <AlertTriangle className="w-6 h-6 text-accent-amber" />
              </div>
              <div>
                <h3 className="font-medium text-white mb-2">How Volume Spike Detection Works</h3>
                <p className="text-sm text-gray-400 mb-4">
                  The scanner uses Dome API candlestick data to detect unusual trading activity that may indicate 
                  market-moving events or increased interest.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border">
                    <p className="text-accent-cyan font-medium">Hourly Candles</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Compares current hour volume against 24h rolling average
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border">
                    <p className="text-accent-cyan font-medium">$1,000+ Volume</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Minimum volume threshold to filter noise on illiquid markets
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border">
                    <p className="text-accent-cyan font-medium">2x+ Multiplier</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Volume must be at least 2x the 24h average to trigger alert
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Alerts List */}
        {loading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-16 bg-terminal-hover rounded" />
              </div>
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <div className="card p-8 text-center">
            <Activity className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-400 mb-2">
              No Volume Spikes Detected
            </h3>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              No significant volume spikes detected in the selected time period.
              Try adjusting the filters or check back after the next sync cycle.
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Platform</th>
                  <th className="text-right">Current Volume</th>
                  <th className="text-right">24h Avg</th>
                  <th className="text-right">Spike</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td className="max-w-xs">
                      <Link
                        href={`/markets/${alert.marketId}`}
                        className="text-accent-cyan hover:text-accent-cyan/80 flex items-center gap-2"
                      >
                        <span className="truncate">{alert.title}</span>
                        <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-50" />
                      </Link>
                    </td>
                    <td>
                      <span className={cn(
                        'px-2 py-1 text-xs font-medium rounded',
                        alert.platform === 'polymarket' 
                          ? 'text-purple-400 bg-purple-500/20' 
                          : 'text-blue-400 bg-blue-500/20'
                      )}>
                        {alert.platform.toUpperCase()}
                      </span>
                    </td>
                    <td className="text-right font-mono text-white">
                      {formatCurrency(alert.volumeUsd)}
                    </td>
                    <td className="text-right font-mono text-gray-400">
                      {formatCurrency(alert.rollingAvg)}
                    </td>
                    <td className="text-right">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm font-medium',
                        getMultiplierColor(alert.multiplier)
                      )}>
                        <ArrowUp className="h-3 w-3" />
                        {alert.multiplier.toFixed(1)}x
                      </span>
                    </td>
                    <td className="text-gray-500 text-sm">
                      {formatRelativeTime(new Date(alert.alertedAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Z-Score Reference */}
        <div className="mt-8 card">
          <div className="card-header">
            <h3 className="font-medium text-white">Z-Score Interpretation</h3>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-terminal-bg">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <div>
                  <p className="text-gray-300">Z = 2.0</p>
                  <p className="text-xs text-gray-500">97.7th percentile - Unusual</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-terminal-bg">
                <div className="w-3 h-3 rounded-full bg-accent-amber" />
                <div>
                  <p className="text-gray-300">Z = 2.5</p>
                  <p className="text-xs text-gray-500">99.4th percentile - Very unusual</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-lg bg-terminal-bg">
                <div className="w-3 h-3 rounded-full bg-loss-mid" />
                <div>
                  <p className="text-gray-300">Z = 3.0+</p>
                  <p className="text-xs text-gray-500">99.9th percentile - Extremely unusual</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
