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
  volume_all_time: string | null;
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
              <th className="text-right">Volume</th>
              <th>Quality</th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center py-8 text-gray-500">
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
                const volume24h = parseFloat(market.volume_24h) || 0;
                const volumeAllTime = market.volume_all_time ? parseFloat(market.volume_all_time) : null;
                
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
                    <td className="max-w-xs">
                      <div className="group relative">
                        <div className="truncate">{market.title}</div>
                        <div className="absolute left-0 top-full z-10 mt-1 px-2 py-1 text-xs text-white bg-gray-900 rounded border border-gray-700 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-normal max-w-md break-words shadow-lg">
                          {market.title}
                        </div>
                      </div>
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
                    <td className="text-right font-mono">
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="text-accent-cyan">{formatCurrency(volume24h, 0)}</span>
                        {volumeAllTime !== null && volumeAllTime > 0 && (
                          <span className="text-gray-500 text-xs">{formatCurrency(volumeAllTime, 0)}</span>
                        )}
                      </div>
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
