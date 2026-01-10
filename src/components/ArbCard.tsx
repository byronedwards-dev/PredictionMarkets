'use client';

import { cn, formatCurrency, formatPercent, formatRelativeTime, formatDuration, getQualityColor, getQualityBgColor, getPlatformColor } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle, Zap, Clock, DollarSign } from 'lucide-react';
import { useState } from 'react';

interface ArbCardProps {
  arb: {
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
  };
}

export function ArbCard({ arb }: ArbCardProps) {
  const [expanded, setExpanded] = useState(false);
  
  const grossSpread = parseFloat(arb.gross_spread_pct);
  const totalFees = parseFloat(arb.total_fees_pct);
  const netSpread = parseFloat(arb.net_spread_pct);
  const maxDeployable = parseFloat(arb.max_deployable_usd);
  const potentialProfit = parseFloat(arb.capital_weighted_spread);
  
  const isCrossPlatform = arb.type === 'cross_platform';
  const title = isCrossPlatform 
    ? `${arb.poly_title || 'Polymarket'} ↔ ${arb.kalshi_title || 'Kalshi'}`
    : arb.market_title;
  
  return (
    <div className={cn(
      'card overflow-hidden transition-all',
      arb.quality === 'executable' && 'border-profit-low/50 glow-profit',
      arb.quality === 'thin' && 'border-accent-amber/50',
    )}>
      {/* Header */}
      <div 
        className="p-4 cursor-pointer hover:bg-terminal-hover transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {/* Type badge */}
            <div className="flex items-center gap-2 mb-2">
              {isCrossPlatform ? (
                <span className="px-2 py-0.5 text-xs font-medium rounded bg-accent-purple/20 text-accent-purple border border-accent-purple/30">
                  CROSS-PLATFORM
                </span>
              ) : (
                <span className={cn(
                  'px-2 py-0.5 text-xs font-medium rounded',
                  getPlatformColor(arb.platform || 'unknown'),
                  arb.platform === 'polymarket' ? 'bg-purple-500/20 border border-purple-500/30' :
                  'bg-blue-500/20 border border-blue-500/30'
                )}>
                  {arb.platform?.toUpperCase() || 'UNDERROUND'}
                </span>
              )}
              <span className={cn(
                'px-2 py-0.5 text-xs font-medium rounded border',
                getQualityBgColor(arb.quality),
                getQualityColor(arb.quality)
              )}>
                {arb.quality.toUpperCase()}
              </span>
            </div>
            
            {/* Title */}
            <h3 className="font-medium text-white truncate">{title}</h3>
            
            {/* Quick stats */}
            <div className="flex items-center gap-4 mt-2 text-sm">
              <span className="text-profit-low font-mono font-medium">
                {formatPercent(netSpread)} net
              </span>
              <span className="text-gray-400">
                {formatCurrency(maxDeployable, 0)} deployable
              </span>
              <span className="text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatRelativeTime(new Date(arb.detected_at))}
              </span>
            </div>
          </div>
          
          {/* Expand button */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-xs text-gray-400">Potential Profit</p>
              <p className="font-mono font-bold text-profit-low">
                {formatCurrency(potentialProfit)}
              </p>
            </div>
            {expanded ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </div>
        </div>
      </div>
      
      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-terminal-border p-4 bg-terminal-bg/50 space-y-4 animate-fade-in">
          {/* Fee breakdown */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Spread Breakdown
            </h4>
            <div className="space-y-1 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Gross Spread</span>
                <span className="text-white">{formatPercent(grossSpread)}</span>
              </div>
              <div className="flex justify-between text-loss-mid">
                <span>Platform Fees</span>
                <span>-{totalFees.toFixed(2)}%</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-terminal-border">
                <span className="text-gray-400">Net Spread</span>
                <span className={cn(
                  'font-bold',
                  netSpread >= 2 ? 'text-profit-low' : 'text-accent-amber'
                )}>
                  {formatPercent(netSpread)}
                </span>
              </div>
            </div>
          </div>
          
          {/* Liquidity info */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Liquidity
            </h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Max Deployable</p>
                <p className="font-mono text-white">{formatCurrency(maxDeployable)}</p>
              </div>
              <div>
                <p className="text-gray-500">Potential Profit</p>
                <p className="font-mono text-profit-low">{formatCurrency(potentialProfit)}</p>
              </div>
            </div>
          </div>
          
          {/* Persistence info */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Persistence
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Duration</p>
                <p className="font-mono text-white">{formatDuration(arb.duration_seconds)}</p>
              </div>
              <div>
                <p className="text-gray-500">Snapshots</p>
                <p className="font-mono text-white">{arb.snapshot_count}</p>
              </div>
              <div>
                <p className="text-gray-500">Last Seen</p>
                <p className="font-mono text-white">{formatRelativeTime(new Date(arb.last_seen_at))}</p>
              </div>
            </div>
          </div>
          
          {/* Warning for thin/theoretical */}
          {arb.quality !== 'executable' && (
            <div className={cn(
              'flex items-start gap-2 p-3 rounded-lg text-sm',
              arb.quality === 'thin' 
                ? 'bg-accent-amber/10 text-accent-amber'
                : 'bg-gray-500/10 text-gray-400'
            )}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p>
                {arb.quality === 'thin' 
                  ? 'Limited liquidity - may not be worth gas/effort for small positions.'
                  : 'Theoretical opportunity only - insufficient liquidity for execution.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
