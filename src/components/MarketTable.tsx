'use client';

import { cn, formatCurrency, formatPercent, getPlatformColor, getQualityColor, getQualityBgColor } from '@/lib/utils';

interface Market {
  id: number;
  platform: string;
  title: string;
  sport: string | null;
  status: string;
  yes_bid: string;
  no_bid: string;
  yes_bid_size: string;
  no_bid_size: string;
  volume_24h: string;
  gross_spread: string;
  arb_id: number | null;
  arb_quality: 'executable' | 'thin' | 'theoretical' | null;
  net_spread_pct: string | null;
  max_deployable_usd: string | null;
}

interface MarketTableProps {
  markets: Market[];
  loading?: boolean;
}

export function MarketTable({ markets, loading }: MarketTableProps) {
  if (loading) {
    return (
      <div className="card">
        <div className="animate-pulse p-4 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-terminal-hover rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Market</th>
              <th>Sport</th>
              <th className="text-right">YES Bid</th>
              <th className="text-right">NO Bid</th>
              <th className="text-right">Sum</th>
              <th className="text-right">Gross Spread</th>
              <th className="text-right">Net Spread</th>
              <th className="text-right">Deployable</th>
              <th className="text-right">Volume 24h</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td colSpan={11} className="text-center py-8 text-gray-500">
                  No markets found
                </td>
              </tr>
            ) : (
              markets.map((market) => {
                const yesBid = parseFloat(market.yes_bid) || 0;
                const noBid = parseFloat(market.no_bid) || 0;
                const sum = yesBid + noBid;
                const grossSpread = parseFloat(market.gross_spread) || 0;
                const netSpread = market.net_spread_pct ? parseFloat(market.net_spread_pct) : null;
                const maxDeployable = market.max_deployable_usd ? parseFloat(market.max_deployable_usd) : null;
                const volume = parseFloat(market.volume_24h) || 0;
                
                const hasArb = market.arb_id !== null;
                
                return (
                  <tr 
                    key={market.id}
                    className={cn(
                      hasArb && market.arb_quality === 'executable' && 'bg-profit-low/5',
                      hasArb && market.arb_quality === 'thin' && 'bg-accent-amber/5',
                    )}
                  >
                    <td>
                      <span className={cn(
                        'px-2 py-1 text-xs font-medium rounded',
                        getPlatformColor(market.platform),
                        market.platform === 'polymarket' 
                          ? 'bg-purple-500/20' 
                          : 'bg-blue-500/20'
                      )}>
                        {market.platform === 'polymarket' ? 'POLY' : 'KALSHI'}
                      </span>
                    </td>
                    <td className="max-w-xs truncate" title={market.title}>
                      {market.title}
                    </td>
                    <td>
                      {market.sport ? (
                        <span className="px-2 py-1 text-xs font-medium rounded bg-terminal-hover text-gray-300 uppercase">
                          {market.sport}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                    <td className="text-right font-mono">
                      {yesBid.toFixed(2)}
                    </td>
                    <td className="text-right font-mono">
                      {noBid.toFixed(2)}
                    </td>
                    <td className={cn(
                      'text-right font-mono',
                      sum < 1 ? 'text-profit-low' : 'text-gray-400'
                    )}>
                      {sum.toFixed(2)}
                    </td>
                    <td className={cn(
                      'text-right font-mono',
                      grossSpread > 0.02 ? 'text-profit-low' : 
                      grossSpread > 0 ? 'text-accent-amber' : 'text-gray-400'
                    )}>
                      {formatPercent(grossSpread * 100)}
                    </td>
                    <td className={cn(
                      'text-right font-mono font-medium',
                      netSpread !== null ? (
                        netSpread >= 2 ? 'text-profit-low' : 'text-accent-amber'
                      ) : 'text-gray-600'
                    )}>
                      {netSpread !== null ? formatPercent(netSpread) : '-'}
                    </td>
                    <td className="text-right font-mono">
                      {maxDeployable !== null ? formatCurrency(maxDeployable, 0) : '-'}
                    </td>
                    <td className="text-right font-mono text-gray-400">
                      {formatCurrency(volume, 0)}
                    </td>
                    <td>
                      {market.arb_quality ? (
                        <span className={cn(
                          'px-2 py-1 text-xs font-medium rounded border',
                          getQualityBgColor(market.arb_quality),
                          getQualityColor(market.arb_quality)
                        )}>
                          {market.arb_quality.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
