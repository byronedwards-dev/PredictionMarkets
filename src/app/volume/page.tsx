'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, Activity, TrendingUp, AlertTriangle } from 'lucide-react';
import { cn, formatCurrency, formatRelativeTime } from '@/lib/utils';

interface VolumeAlert {
  id: number;
  market_id: number;
  market_title: string;
  platform: string;
  volume_usd: string;
  rolling_avg_7d: string;
  rolling_stddev_7d: string;
  z_score: string;
  multiplier: string;
  market_age_hours: number;
  alert_at: string;
}

export default function VolumePage() {
  const [alerts, setAlerts] = useState<VolumeAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      // For now, show a placeholder - volume alerts will be populated by the sync job
      // once we have enough historical data (7+ days)
      setAlerts([]);
    } catch (err) {
      console.error('Failed to fetch volume alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Volume Alerts</h1>
            <p className="text-gray-400 text-sm mt-1">
              Statistical detection of unusual trading activity
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
                  The scanner uses statistical analysis to detect unusual trading activity that may indicate 
                  insider information or market-moving events.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border">
                    <p className="text-accent-cyan font-medium">Z-Score ≥ 2.5</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Volume must be 2.5+ standard deviations above the 7-day average
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border">
                    <p className="text-accent-cyan font-medium">$10,000+ Volume</p>
                    <p className="text-gray-500 text-xs mt-1">
                      Minimum absolute volume to filter out noise on illiquid markets
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border">
                    <p className="text-accent-cyan font-medium">48+ Hour Market Age</p>
                    <p className="text-gray-500 text-xs mt-1">
                      New markets naturally have volatile volume patterns
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
              Volume spike detection requires at least 7 days of historical data. 
              The scanner will begin detecting unusual activity once enough data has accumulated.
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
                  <th className="text-right">7-Day Avg</th>
                  <th className="text-right">Z-Score</th>
                  <th className="text-right">Multiplier</th>
                  <th>Detected</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => {
                  const zScore = parseFloat(alert.z_score);
                  const multiplier = parseFloat(alert.multiplier);
                  
                  return (
                    <tr key={alert.id}>
                      <td className="max-w-xs truncate">{alert.market_title}</td>
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
                        {formatCurrency(parseFloat(alert.volume_usd))}
                      </td>
                      <td className="text-right font-mono text-gray-400">
                        {formatCurrency(parseFloat(alert.rolling_avg_7d))}
                      </td>
                      <td className={cn(
                        'text-right font-mono font-medium',
                        zScore >= 3 ? 'text-loss-mid' :
                        zScore >= 2.5 ? 'text-accent-amber' :
                        'text-gray-400'
                      )}>
                        {zScore.toFixed(2)}
                      </td>
                      <td className="text-right font-mono text-accent-cyan">
                        {multiplier.toFixed(1)}x
                      </td>
                      <td className="text-gray-500 text-sm">
                        {formatRelativeTime(new Date(alert.alert_at))}
                      </td>
                    </tr>
                  );
                })}
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
