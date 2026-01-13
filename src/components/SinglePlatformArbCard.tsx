'use client';

import { cn, formatCurrency, formatPercent, formatRelativeTime, formatDuration, getQualityColor, getQualityBgColor, getPlatformColor } from '@/lib/utils';
import { ChevronDown, ChevronUp, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import { useState } from 'react';

interface SinglePlatformArbCardProps {
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
    details: Record<string, unknown>;
  };
}

export function SinglePlatformArbCard({ arb }: SinglePlatformArbCardProps) {
  const [expanded, setExpanded] = useState(false);
  
  const grossSpread = parseFloat(arb.gross_spread_pct);
  const totalFees = parseFloat(arb.total_fees_pct);
  const netSpread = parseFloat(arb.net_spread_pct);
  const maxDeployable = parseFloat(arb.max_deployable_usd);
  const potentialProfit = parseFloat(arb.capital_weighted_spread);
  
  const isMultiOutcome = arb.type === 'multi_outcome';
  
  // Extract data from details
  const details = arb.details || {};
  const marketTitle = arb.market_title || (details.marketTitle as string) || null;
  const eventName = (details.eventName as string) || null;
  const platform = arb.platform || (details.platform as string) || 'unknown';
  
  // For underround arbs - extract YES/NO bid prices
  const yesBid = (details.yesBid as number) || 0;
  const noBid = (details.noBid as number) || 0;
  const priceSum = yesBid + noBid;
  
  // For multi-outcome arbs - extract outcomes
  const outcomes = (details.outcomes as Array<{ marketId: number; title: string; yesAsk: number; askSize: number }>) || [];
  const totalCost = (details.totalCost as number) || outcomes.reduce((sum, o) => sum + o.yesAsk, 0);
  
  // Build display title
  const title = isMultiOutcome 
    ? eventName || 'Multi-Outcome Opportunity'
    : marketTitle || 'Single Market Opportunity';
  
  // Platform link
  const getPlatformUrl = () => {
    if (platform === 'polymarket') {
      return `https://polymarket.com`;
    } else if (platform === 'kalshi') {
      return `https://kalshi.com`;
    }
    return null;
  };
  
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
            {/* Type & Platform badges */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={cn(
                'px-2 py-0.5 text-xs font-medium rounded',
                getPlatformColor(platform),
                platform === 'polymarket' ? 'bg-purple-500/20 border border-purple-500/30' :
                'bg-blue-500/20 border border-blue-500/30'
              )}>
                {platform.toUpperCase()}
              </span>
              <span className={cn(
                'px-2 py-0.5 text-xs font-medium rounded',
                isMultiOutcome 
                  ? 'bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/30'
                  : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
              )}>
                {isMultiOutcome ? `MULTI-OUTCOME (${outcomes.length})` : 'UNDERROUND'}
              </span>
              <span className={cn(
                'px-2 py-0.5 text-xs font-medium rounded border',
                getQualityBgColor(arb.quality),
                getQualityColor(arb.quality)
              )}>
                {arb.quality.toUpperCase()}
              </span>
            </div>
            
            {/* Title */}
            <h3 className="font-medium text-white">{title}</h3>
            
            {/* Price Sum Display - KEY FEATURE */}
            <div className="mt-3 p-3 rounded-lg bg-terminal-bg border border-terminal-border">
              {isMultiOutcome ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Buy all {outcomes.length} outcomes:</span>
                    <span className="font-mono text-white">{(totalCost * 100).toFixed(1)}¢</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">Guaranteed payout:</span>
                    <span className="font-mono text-white">$1.00</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-terminal-border">
                    <span className="text-profit-mid font-medium">Gross Profit:</span>
                    <span className="font-mono font-bold text-profit-low">
                      {((1 - totalCost) * 100).toFixed(1)}¢ ({formatPercent(grossSpread)})
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">YES bid price:</span>
                    <span className="font-mono text-green-400">{(yesBid * 100).toFixed(1)}¢</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">NO bid price:</span>
                    <span className="font-mono text-red-400">{(noBid * 100).toFixed(1)}¢</span>
                  </div>
                  <div className="flex items-center justify-between text-sm pt-2 border-t border-terminal-border">
                    <span className="text-gray-400">Sum (YES + NO):</span>
                    <span className={cn(
                      'font-mono font-bold',
                      priceSum < 1 ? 'text-profit-low' : 'text-white'
                    )}>
                      {(priceSum * 100).toFixed(1)}¢
                    </span>
                  </div>
                  {priceSum < 1 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-profit-mid font-medium">Gross Spread:</span>
                      <span className="font-mono font-bold text-profit-low">
                        {((1 - priceSum) * 100).toFixed(1)}¢ ({formatPercent(grossSpread)})
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            {/* Quick stats */}
            <div className="flex items-center gap-4 mt-3 text-sm">
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
          {/* Multi-outcome breakdown */}
          {isMultiOutcome && outcomes.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
                Outcome Prices
              </h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {outcomes.map((outcome, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-terminal-hover">
                    <span className="text-gray-300 truncate flex-1 mr-4" title={outcome.title}>
                      {outcome.title}
                    </span>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="font-mono text-white">{(outcome.yesAsk * 100).toFixed(1)}¢</span>
                      <span className="text-gray-500">${outcome.askSize?.toLocaleString() || '?'}</span>
                    </div>
                  </div>
                ))}
              </div>
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
              <div className="flex justify-between text-loss-mid">
                <span>Platform Fees (×2 sides)</span>
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
          
          {/* Strategy explanation */}
          <div className="p-3 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30">
            <h4 className="text-xs font-medium text-accent-cyan uppercase tracking-wide mb-2">
              Strategy
            </h4>
            <p className="text-sm text-gray-300">
              {isMultiOutcome 
                ? `Buy YES on all ${outcomes.length} outcomes for a total of ${(totalCost * 100).toFixed(1)}¢. One outcome must win, paying $1.00. Net profit after fees: ${formatPercent(netSpread)}.`
                : `Buy both YES (${(yesBid * 100).toFixed(1)}¢) and NO (${(noBid * 100).toFixed(1)}¢) for ${(priceSum * 100).toFixed(1)}¢ total. One side must pay $1.00. Net profit after fees: ${formatPercent(netSpread)}.`
              }
            </p>
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
