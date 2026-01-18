'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ArrowLeft, ExternalLink, RefreshCcw, TrendingUp, Clock, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';

interface Market {
  id: number;
  platform: string;
  platform_id: string;
  event_id: string | null;
  title: string;
  category: string | null;
  sport: string | null;
  status: string;
  resolution_date: string | null;
  outcome: string | null;
  external_url: string | null;
  created_at: string;
  updated_at: string;
}

interface PriceSnapshot {
  snapshot_at: string;
  yes_price: string;
  no_price: string;
  yes_bid: string | null;
  yes_ask: string | null;
  no_bid: string | null;
  no_ask: string | null;
  volume_24h: string | null;
  volume_all_time: string | null;
}

interface MarketData {
  market: Market;
  current: PriceSnapshot | null;
  history: PriceSnapshot[];
  timeRange: {
    hours: number;
    start: string;
    end: string;
    snapshotCount: number;
  };
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function formatPrice(price: number): string {
  return `${(price * 100).toFixed(1)}¢`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(24); // Default to 24h

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/markets/${params.id}?hours=${timeRange}`);
        
        if (!res.ok) {
          if (res.status === 404) {
            setError('Market not found');
          } else {
            setError('Failed to load market');
          }
          return;
        }

        const json = await res.json();
        setData(json);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch market:', err);
        setError('Failed to load market');
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchData();
    }
  }, [params.id, timeRange]);

  // Transform history for charts
  const chartData = data?.history.map(snapshot => {
    const yesPrice = parseFloat(snapshot.yes_price);
    const noPrice = parseFloat(snapshot.no_price);
    const yesBid = parseFloat(snapshot.yes_bid || snapshot.yes_price);
    const noBid = parseFloat(snapshot.no_bid || snapshot.no_price);
    const spread = 1 - yesBid - noBid; // Gross spread
    
    return {
      time: formatShortDate(snapshot.snapshot_at),
      timestamp: new Date(snapshot.snapshot_at).getTime(),
      yes: yesPrice * 100,
      no: noPrice * 100,
      spread: spread * 100, // Spread as percentage
      volume24h: parseFloat(snapshot.volume_24h || '0'),
      volumeAllTime: parseFloat(snapshot.volume_all_time || '0'),
    };
  }) || [];

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto flex items-center justify-center min-h-[60vh]">
          <RefreshCcw className="w-8 h-8 text-accent-cyan animate-spin" />
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Markets
          </button>
          <div className="text-center py-20 text-gray-500">
            <p>{error || 'Market not found'}</p>
          </div>
        </main>
      </div>
    );
  }

  const { market, current } = data;
  const yesPrice = current ? parseFloat(current.yes_price) : 0;
  const noPrice = current ? parseFloat(current.no_price) : 0;
  const volume24h = current ? parseFloat(current.volume_24h || '0') : 0;
  const volumeAllTime = current?.volume_all_time ? parseFloat(current.volume_all_time) : null;

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Back Button */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Markets
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium uppercase',
                  market.platform === 'polymarket' 
                    ? 'bg-purple-500/20 text-purple-400' 
                    : 'bg-blue-500/20 text-blue-400'
                )}>
                  {market.platform}
                </span>
                {market.sport && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-accent-cyan/20 text-accent-cyan uppercase">
                    {market.sport}
                  </span>
                )}
                <span className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium',
                  market.status === 'open' 
                    ? 'bg-profit-low/20 text-profit-low' 
                    : 'bg-gray-500/20 text-gray-400'
                )}>
                  {market.status}
                </span>
              </div>
              <h1 className="text-2xl font-display font-bold text-white leading-tight">
                {market.title}
              </h1>
              {market.category && (
                <p className="text-gray-400 text-sm mt-2">
                  Category: {market.category}
                </p>
              )}
            </div>
            <a
              href={
                market.platform === 'polymarket'
                  ? (market.platform_id 
                      ? `https://polymarket.com/market/${market.platform_id}`
                      : `https://polymarket.com/markets?query=${encodeURIComponent(market.title)}`)
                  : `https://kalshi.com/markets/${market.platform_id?.split('-')[0]?.toLowerCase() || ''}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              View on {market.platform === 'polymarket' ? 'Polymarket' : 'Kalshi'}
            </a>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <TrendingUp className="w-3 h-3" />
              YES Price
            </div>
            <div className="text-2xl font-display font-bold text-profit-low">
              {formatPrice(yesPrice)}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <TrendingUp className="w-3 h-3" />
              NO Price
            </div>
            <div className="text-2xl font-display font-bold text-loss">
              {formatPrice(noPrice)}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <DollarSign className="w-3 h-3" />
              ~24h Volume
            </div>
            <div className="text-2xl font-display font-bold text-accent-cyan">
              {formatVolume(volume24h)}
            </div>
          </div>
          <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
            <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
              <DollarSign className="w-3 h-3" />
              All-Time Volume
            </div>
            <div className="text-2xl font-display font-bold text-gray-300">
              {volumeAllTime !== null ? formatVolume(volumeAllTime) : 'N/A'}
            </div>
          </div>
        </div>

        {/* Time Range Selector */}
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="text-gray-400 text-sm">Time Range:</span>
          {[1, 24, 168, 720].map(hours => (
            <button
              key={hours}
              onClick={() => setTimeRange(hours)}
              className={cn(
                'px-3 py-1 rounded text-sm transition-colors',
                timeRange === hours
                  ? 'bg-accent-cyan/20 text-accent-cyan'
                  : 'bg-terminal-card text-gray-400 hover:text-white'
              )}
            >
              {hours === 1 ? '1h' : hours === 24 ? '24h' : hours === 168 ? '7d' : '30d'}
            </button>
          ))}
        </div>

        {/* Charts */}
        {chartData.length > 0 ? (
          <div className="space-y-6">
            {/* Price Chart */}
            <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
              <h3 className="text-white font-medium mb-4">Price History</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#6b7280"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis 
                      stroke="#6b7280"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}¢`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #2a2a3c',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(value: number) => [`${value.toFixed(1)}¢`, '']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="yes" 
                      name="YES" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="no" 
                      name="NO" 
                      stroke="#ef4444" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Spread Chart */}
            <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
              <h3 className="text-white font-medium mb-4">Spread Over Time</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#6b7280"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis 
                      stroke="#6b7280"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      domain={[0, 10]}
                      tickFormatter={(v) => `${v.toFixed(1)}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #2a2a3c',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(value: number) => [`${value.toFixed(2)}%`, 'Spread']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="spread" 
                      name="Gross Spread" 
                      stroke="#f59e0b" 
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Volume Chart */}
            <div className="p-4 rounded-lg bg-terminal-card border border-terminal-border">
              <h3 className="text-white font-medium mb-4">Volume Over Time</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3c" />
                    <XAxis 
                      dataKey="time" 
                      stroke="#6b7280"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                    />
                    <YAxis 
                      stroke="#6b7280"
                      tick={{ fill: '#6b7280', fontSize: 12 }}
                      tickFormatter={(v) => formatVolume(v)}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1a1a2e',
                        border: '1px solid #2a2a3c',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(value: number) => [formatVolume(value), '']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="volumeAllTime" 
                      name="All-Time Volume" 
                      fill="#06b6d4" 
                      fillOpacity={0.2}
                      stroke="#06b6d4"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 rounded-lg bg-terminal-card border border-terminal-border text-center text-gray-500">
            <p>No price history available for this time range.</p>
            <p className="text-sm mt-2">Data will appear after the sync runs a few times.</p>
          </div>
        )}

        {/* Market Details */}
        <div className="mt-8 p-4 rounded-lg bg-terminal-card border border-terminal-border">
          <h3 className="text-white font-medium mb-4">Market Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-400">Platform ID:</span>
              <span className="text-gray-300 ml-2 font-mono">{market.platform_id}</span>
            </div>
            {market.event_id && (
              <div>
                <span className="text-gray-400">Event ID:</span>
                <span className="text-gray-300 ml-2 font-mono">{market.event_id}</span>
              </div>
            )}
            {market.resolution_date && (
              <div>
                <span className="text-gray-400">Resolution Date:</span>
                <span className="text-gray-300 ml-2">{formatDate(market.resolution_date)}</span>
              </div>
            )}
            {market.outcome && (
              <div>
                <span className="text-gray-400">Outcome:</span>
                <span className="text-gray-300 ml-2">{market.outcome}</span>
              </div>
            )}
            <div>
              <span className="text-gray-400">Data Points:</span>
              <span className="text-gray-300 ml-2">{data.timeRange.snapshotCount} snapshots</span>
            </div>
            <div>
              <span className="text-gray-400">Last Updated:</span>
              <span className="text-gray-300 ml-2">{formatDate(market.updated_at)}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
