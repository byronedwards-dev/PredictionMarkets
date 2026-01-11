'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, Filter, X, ChevronDown, ChevronRight, Zap, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Market {
  id: number;
  platform: string;
  platform_id: string;
  title: string;
  sport: string | null;
  status: string;
  yes_bid: string | null;
  no_bid: string | null;
  yes_bid_size: string | null;
  no_bid_size: string | null;
  volume_24h: string | null;
  volume_all_time: string | null;
  gross_spread: string | null;
  arb_id: number | null;
  arb_quality: 'executable' | 'thin' | 'theoretical' | null;
  net_spread_pct: string | null;
  max_deployable_usd: string | null;
}

interface EventGroup {
  event_key: string;
  event_name: string;
  platform: string;
  sport: string | null;
  total_volume_24h: number;
  total_volume_all_time: number;
  market_count: number;
  has_arb: boolean;
  best_arb_spread: number | null;
  markets: Market[];
}

interface Filters {
  platform: string;
  sport: string;
  status: string;
  hasArb: boolean;
  minVolume: string;
}

function formatVolume(volume: number | null | undefined): string {
  if (volume == null || isNaN(volume)) return '$0';
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(0)}K`;
  return `$${volume.toFixed(0)}`;
}

function formatPrice(price: string | null): string {
  if (!price) return '—';
  const num = parseFloat(price);
  if (num < 0) return '—'; // Invalid price
  return num.toFixed(2);
}

function formatSpread(spread: string | null): string {
  if (!spread) return '—';
  const num = parseFloat(spread) * 100;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

function EventCard({ event, isExpanded, onToggle }: { 
  event: EventGroup; 
  isExpanded: boolean; 
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-card overflow-hidden">
      {/* Event Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-terminal-hover transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          
          <span className={cn(
            'px-2 py-0.5 rounded text-xs font-medium uppercase',
            event.platform === 'polymarket' 
              ? 'bg-purple-500/20 text-purple-400' 
              : 'bg-blue-500/20 text-blue-400'
          )}>
            {event.platform === 'polymarket' ? 'POLY' : 'KALSHI'}
          </span>
          
          <div className="text-left">
            <h3 className="text-white font-medium text-sm">{event.event_name}</h3>
            <p className="text-gray-500 text-xs">
              {event.market_count} market{event.market_count !== 1 ? 's' : ''}
              {event.sport && <span className="ml-2 text-accent-cyan">{event.sport.toUpperCase()}</span>}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          {event.has_arb && (
            <div className="flex items-center gap-1 text-profit-low">
              <Zap className="w-4 h-4" />
              <span className="text-sm font-medium">
                {event.best_arb_spread ? `+${(event.best_arb_spread * 100).toFixed(2)}%` : 'ARB'}
              </span>
            </div>
          )}
          
          <div className="flex items-center gap-6">
            <div className="text-right">
              <span className="text-sm font-semibold text-accent-cyan">{formatVolume(event.total_volume_24h)}</span>
              <p className="text-gray-500 text-xs">~24h vol</p>
            </div>
            {event.total_volume_all_time && event.total_volume_all_time > 0 && (
              <div className="text-right">
                <span className="text-sm font-semibold text-gray-300">{formatVolume(event.total_volume_all_time)}</span>
                <p className="text-gray-500 text-xs">all-time</p>
              </div>
            )}
          </div>
        </div>
      </button>
      
      {/* Expanded Markets Table */}
      {isExpanded && (
        <div className="border-t border-terminal-border">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-2 text-left font-medium">Market</th>
                <th className="px-4 py-2 text-right font-medium">YES</th>
                <th className="px-4 py-2 text-right font-medium">NO</th>
                <th className="px-4 py-2 text-right font-medium">Sum</th>
                <th className="px-4 py-2 text-right font-medium">Spread</th>
                <th className="px-4 py-2 text-right font-medium">~24h</th>
                <th className="px-4 py-2 text-right font-medium">All-Time</th>
                <th className="px-4 py-2 text-right font-medium">Quality</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border">
              {event.markets.map((market) => {
                const yesBid = parseFloat(market.yes_bid || '0');
                const noBid = parseFloat(market.no_bid || '0');
                const sum = yesBid + noBid;
                const isValidSum = sum > 0 && sum <= 1.1;
                
                return (
                  <tr 
                    key={market.id} 
                    className={cn(
                      'hover:bg-terminal-hover/50 transition-colors',
                      market.arb_id && 'bg-profit-low/5'
                    )}
                  >
                    <td className="px-4 py-2">
                      <a 
                        href={`/markets/${market.id}`}
                        className="group block"
                        title={market.title}
                      >
                        <p className="text-sm text-gray-300 truncate max-w-md group-hover:text-accent-cyan transition-colors">
                          {market.title}
                        </p>
                        <p className="text-xs text-gray-600 group-hover:text-gray-500 hidden sm:block">
                          Click for details
                        </p>
                      </a>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-sm text-profit-low font-mono">
                        {formatPrice(market.yes_bid)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-sm text-loss font-mono">
                        {formatPrice(market.no_bid)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn(
                        'text-sm font-mono',
                        isValidSum ? 'text-gray-400' : 'text-gray-600'
                      )}>
                        {isValidSum ? sum.toFixed(2) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={cn(
                        'text-sm font-mono',
                        parseFloat(market.gross_spread || '0') > 0 ? 'text-profit-low' : 'text-gray-400'
                      )}>
                        {formatSpread(market.gross_spread)}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-sm text-accent-cyan font-mono">
                        {formatVolume(parseFloat(market.volume_24h || '0'))}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {market.volume_all_time ? (
                        <span className="text-sm text-gray-400 font-mono">
                          {formatVolume(parseFloat(market.volume_all_time))}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {market.arb_quality ? (
                        <span className={cn(
                          'px-2 py-0.5 rounded text-xs font-medium',
                          market.arb_quality === 'executable' && 'bg-profit-high/20 text-profit-high',
                          market.arb_quality === 'thin' && 'bg-profit-low/20 text-profit-low',
                          market.arb_quality === 'theoretical' && 'bg-yellow-500/20 text-yellow-400'
                        )}>
                          {market.arb_quality}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MarketsPage() {
  const [events, setEvents] = useState<EventGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>({
    platform: '',
    sport: '',
    status: 'open',
    hasArb: false,
    minVolume: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const doFetch = async () => {
      try {
        setLoading(true);
        
        const params = new URLSearchParams();
        if (filters.platform) params.set('platform', filters.platform);
        if (filters.sport) params.set('sport', filters.sport);
        if (filters.status) params.set('status', filters.status);
        if (filters.hasArb) params.set('hasArb', 'true');
        if (filters.minVolume) params.set('minVolume', filters.minVolume);
        params.set('limit', '200');
        params.set('groupByEvent', 'true');
        
        const res = await fetch(`/api/markets?${params}`);
        const data = await res.json();
        
        setEvents(data.events || []);
        setTotal(data.total || 0);
        setEventCount(data.eventCount || 0);
        
        // Auto-expand events with arbs
        const arbEvents = (data.events || [])
          .filter((e: EventGroup) => e.has_arb)
          .map((e: EventGroup) => e.event_key);
        setExpandedEvents(new Set(arbEvents));
      } catch (err) {
        console.error('Failed to fetch markets:', err);
      } finally {
        setLoading(false);
      }
    };
    
    doFetch();
  }, [filters]);

  const toggleEvent = (eventKey: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(eventKey)) {
        next.delete(eventKey);
      } else {
        next.add(eventKey);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedEvents(new Set(events.map(e => e.event_key)));
  };

  const collapseAll = () => {
    setExpandedEvents(new Set());
  };

  const clearFilters = () => {
    setFilters({
      platform: '',
      sport: '',
      status: 'open',
      hasArb: false,
      minVolume: '',
    });
  };

  const hasActiveFilters = filters.platform || filters.sport || filters.status !== 'open' || filters.hasArb || filters.minVolume;

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Markets</h1>
            <p className="text-gray-400 text-sm mt-1">
              {total} markets in {eventCount} events
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg border transition-all',
                showFilters || hasActiveFilters
                  ? 'bg-accent-cyan/20 border-accent-cyan/30 text-accent-cyan'
                  : 'bg-terminal-card border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover'
              )}
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-accent-cyan" />
              )}
            </button>
            <button
              onClick={() => setFilters(f => ({ ...f }))}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all disabled:opacity-50"
            >
              <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="mb-6 p-4 rounded-lg bg-terminal-card border border-terminal-border animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Filters</h3>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-gray-400 hover:text-white flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear all
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {/* Platform */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Platform</label>
                <select
                  value={filters.platform}
                  onChange={(e) => setFilters({ ...filters, platform: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-terminal-bg border border-terminal-border text-white text-sm focus:outline-none focus:border-accent-cyan"
                >
                  <option value="">All Platforms</option>
                  <option value="polymarket">Polymarket</option>
                  <option value="kalshi">Kalshi</option>
                </select>
              </div>
              
              {/* Sport */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Sport</label>
                <select
                  value={filters.sport}
                  onChange={(e) => setFilters({ ...filters, sport: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-terminal-bg border border-terminal-border text-white text-sm focus:outline-none focus:border-accent-cyan"
                >
                  <option value="">All Sports</option>
                  <option value="nfl">NFL</option>
                  <option value="nba">NBA</option>
                  <option value="mlb">MLB</option>
                  <option value="nhl">NHL</option>
                </select>
              </div>
              
              {/* Status */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Status</label>
                <select
                  value={filters.status}
                  onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-terminal-bg border border-terminal-border text-white text-sm focus:outline-none focus:border-accent-cyan"
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="">All</option>
                </select>
              </div>
              
              {/* Min Volume */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Min Event Volume</label>
                <select
                  value={filters.minVolume}
                  onChange={(e) => setFilters({ ...filters, minVolume: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-terminal-bg border border-terminal-border text-white text-sm focus:outline-none focus:border-accent-cyan"
                >
                  <option value="">Any</option>
                  <option value="1000">$1,000+</option>
                  <option value="10000">$10,000+</option>
                  <option value="50000">$50,000+</option>
                  <option value="100000">$100,000+</option>
                </select>
              </div>
              
              {/* Has Arb */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Arb Status</label>
                <button
                  onClick={() => setFilters({ ...filters, hasArb: !filters.hasArb })}
                  className={cn(
                    'w-full px-3 py-2 rounded-lg border text-sm text-left transition-all',
                    filters.hasArb
                      ? 'bg-profit-low/20 border-profit-low/30 text-profit-low'
                      : 'bg-terminal-bg border-terminal-border text-gray-400'
                  )}
                >
                  {filters.hasArb ? '✓ Has Active Arb' : 'Show All'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Expand/Collapse Controls */}
        {events.length > 0 && (
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={expandAll}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Expand All
            </button>
            <span className="text-gray-600">·</span>
            <button
              onClick={collapseAll}
              className="text-xs text-gray-400 hover:text-white transition-colors"
            >
              Collapse All
            </button>
          </div>
        )}

        {/* Events List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCcw className="w-8 h-8 text-accent-cyan animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p>No events found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => (
              <EventCard
                key={event.event_key}
                event={event}
                isExpanded={expandedEvents.has(event.event_key)}
                onToggle={() => toggleEvent(event.event_key)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
