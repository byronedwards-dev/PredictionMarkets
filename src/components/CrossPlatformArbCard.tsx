'use client';

import { cn, formatCurrency, formatPercent, formatRelativeTime, formatDuration, getQualityColor, getQualityBgColor } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle, Clock, ExternalLink, ArrowRight } from 'lucide-react';
import { useState } from 'react';

interface CrossPlatformArbCardProps {
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
    poly_title?: string;
    kalshi_title?: string;
    details: Record<string, unknown>;
  };
}

export function CrossPlatformArbCard({ arb }: CrossPlatformArbCardProps) {
  const [expanded, setExpanded] = useState(false);
  
  const grossSpread = parseFloat(arb.gross_spread_pct);
  const totalFees = parseFloat(arb.total_fees_pct);
  const netSpread = parseFloat(arb.net_spread_pct);
  const maxDeployable = parseFloat(arb.max_deployable_usd);
  const potentialProfit = parseFloat(arb.capital_weighted_spread);
  
  // Extract from details
  const details = arb.details || {};
  const polyTitle = arb.poly_title || (details.polyTitle as string) || 'Polymarket Market';
  const kalshiTitle = arb.kalshi_title || (details.kalshiTitle as string) || 'Kalshi Market';
  const arbDirection = (details.arbDirection as string) || 'poly_yes_kalshi_no';
  const strategy = (details.strategy as string) || '';
  
  // Extract prices from details
  const polyYesBid = (details as any).polySnapshot?.yesBid || 0;
  const polyNoBid = (details as any).polySnapshot?.noBid || 0;
  const kalshiYesBid = (details as any).kalshiSnapshot?.yesBid || 0;
  const kalshiNoBid = (details as any).kalshiSnapshot?.noBid || 0;
  
  // Extract platform IDs for URLs
  const polyPlatformId = (details as any).polyPlatformId as string | undefined;
  const kalshiPlatformId = (details as any).kalshiPlatformId as string | undefined;
  
  // Build market URLs
  // Polymarket: Use /market/{platformId} for market slug
  const polyUrl = polyPlatformId 
    ? `https://polymarket.com/market/${polyPlatformId}`
    : 'https://polymarket.com';
  // Kalshi: Extract series ticker (lowercase first segment) for event page
  const kalshiSeriesTicker = kalshiPlatformId?.split('-')[0]?.toLowerCase();
  const kalshiUrl = kalshiSeriesTicker
    ? `https://kalshi.com/markets/${kalshiSeriesTicker}`
    : 'https://kalshi.com';
  
  // Determine buy/sell sides based on direction
  const buyPolyYes = arbDirection === 'poly_yes_kalshi_no';
  const polyBuyPrice = buyPolyYes ? polyYesBid : polyNoBid;
  const polySide = buyPolyYes ? 'YES' : 'NO';
  const kalshiBuyPrice = buyPolyYes ? kalshiNoBid : kalshiYesBid;
  const kalshiSide = buyPolyYes ? 'NO' : 'YES';
  const totalCost = polyBuyPrice + kalshiBuyPrice;
  
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
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 text-xs font-medium rounded bg-accent-purple/20 text-accent-purple border border-accent-purple/30">
                CROSS-PLATFORM
              </span>
              <span className={cn(
                'px-2 py-0.5 text-xs font-medium rounded border',
                getQualityBgColor(arb.quality),
                getQualityColor(arb.quality)
              )}>
                {arb.quality.toUpperCase()}
              </span>
            </div>
            
            {/* Two-column market display */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              {/* Polymarket side */}
              <div className="p-3 rounded-lg bg-terminal-bg border border-purple-500/30">
                <div className="flex items-center justify-between mb-2">
                  <a 
                    href={polyUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    POLYMARKET
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-medium',
                    buyPolyYes ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  )}>
                    Buy {polySide}
                  </span>
                </div>
                <p className="text-sm text-gray-300 line-clamp-2 mb-2" title={polyTitle}>
                  {polyTitle}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{polySide} bid:</span>
                  <span className="font-mono text-white">{(polyBuyPrice * 100).toFixed(1)}¢</span>
                </div>
              </div>
              
              {/* Kalshi side */}
              <div className="p-3 rounded-lg bg-terminal-bg border border-blue-500/30">
                <div className="flex items-center justify-between mb-2">
                  <a 
                    href={kalshiUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    KALSHI
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-medium',
                    !buyPolyYes ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  )}>
                    Buy {kalshiSide}
                  </span>
                </div>
                <p className="text-sm text-gray-300 line-clamp-2 mb-2" title={kalshiTitle}>
                  {kalshiTitle}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{kalshiSide} bid:</span>
                  <span className="font-mono text-white">{(kalshiBuyPrice * 100).toFixed(1)}¢</span>
                </div>
              </div>
            </div>
            
            {/* Combined cost display */}
            {totalCost > 0 && (
              <div className="p-3 rounded-lg bg-terminal-bg border border-terminal-border mb-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">
                    Total cost ({polySide} + {kalshiSide}):
                  </span>
                  <span className={cn(
                    'font-mono font-bold',
                    totalCost < 1 ? 'text-profit-low' : 'text-white'
                  )}>
                    {(totalCost * 100).toFixed(1)}¢
                  </span>
                </div>
                {totalCost < 1 && (
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-profit-mid">Gross Spread:</span>
                    <span className="font-mono font-bold text-profit-low">
                      {((1 - totalCost) * 100).toFixed(1)}¢ ({formatPercent(grossSpread)})
                    </span>
                  </div>
                )}
              </div>
            )}
            
            {/* Quick stats */}
            <div className="flex items-center gap-4 text-sm">
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
              <p className="font-mono font-bold text-profit-low text-lg">
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
          {/* Strategy explanation */}
          {strategy && (
            <div className="p-3 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30">
              <h4 className="text-xs font-medium text-accent-cyan uppercase tracking-wide mb-2">
                Strategy
              </h4>
              <p className="text-sm text-gray-300">{strategy}</p>
            </div>
          )}
          
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
              <div className="flex justify-between text-purple-400">
                <span>Polymarket Fee</span>
                <span>-{((details.polyFeePct as number) || totalFees / 2).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between text-blue-400">
                <span>Kalshi Fee</span>
                <span>-{((details.kalshiFeePct as number) || totalFees / 2).toFixed(2)}%</span>
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
