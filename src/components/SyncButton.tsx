'use client';

import { useState, useEffect } from 'react';
import { RefreshCcw, CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

interface SyncStatus {
  id: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  marketsSynced: number | null;
  arbsDetected: number | null;
  errorMessage: string | null;
  isRunning: boolean;
  runningSince: number | null;
}

interface SyncButtonProps {
  onSyncComplete?: () => void;
  className?: string;
}

export function SyncButton({ onSyncComplete, className }: SyncButtonProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/sync');
      const data = await res.json();
      setStatus(data);
      
      // If sync just completed, trigger refresh callback
      if (data.status === 'completed' && status?.status === 'running') {
        onSyncComplete?.();
      }
    } catch (err) {
      console.error('Failed to fetch sync status:', err);
    }
  };

  // Poll status when running
  useEffect(() => {
    fetchStatus();
    
    const interval = setInterval(() => {
      if (status?.isRunning || loading) {
        fetchStatus();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [status?.isRunning, loading]);

  const triggerSync = async () => {
    setTriggering(true);
    try {
      const res = await fetch('/api/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quick: true }),
      });
      const data = await res.json();
      
      if (data.success) {
        // Quick sync completes inline, just refresh status and callback
        await fetchStatus();
        onSyncComplete?.();
      } else {
        fetchStatus();
      }
    } catch (err) {
      console.error('Failed to trigger sync:', err);
    } finally {
      setTriggering(false);
    }
  };

  const isRunning = status?.isRunning || status?.status === 'requested' || status?.status === 'pending';
  const lastSync = status?.completedAt ? new Date(status.completedAt) : null;
  const syncAge = lastSync ? Math.round((Date.now() - lastSync.getTime()) / 1000 / 60) : null;
  const isStale = syncAge !== null && syncAge > 10; // More than 10 minutes old

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* Status indicator */}
      <div 
        className="relative cursor-pointer"
        onClick={() => setShowDetails(!showDetails)}
      >
        {isRunning ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent-cyan/20 text-accent-cyan text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Syncing{status?.runningSince ? ` (${status.runningSince}s)` : '...'}</span>
          </div>
        ) : status?.status === 'completed' ? (
          <div className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm',
            isStale 
              ? 'bg-accent-amber/20 text-accent-amber' 
              : 'bg-profit-low/20 text-profit-mid'
          )}>
            {isStale ? (
              <Clock className="w-4 h-4" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            <span>
              {lastSync ? formatRelativeTime(lastSync) : 'Synced'}
            </span>
          </div>
        ) : status?.status === 'failed' ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-loss-low/20 text-loss-mid text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Sync failed</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-500/20 text-gray-400 text-sm">
            <Clock className="w-4 h-4" />
            <span>No sync data</span>
          </div>
        )}

        {/* Details popup */}
        {showDetails && status && (
          <div className="absolute top-full right-0 mt-2 p-3 rounded-lg bg-terminal-card border border-terminal-border shadow-lg z-50 min-w-[200px] text-sm">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">Status:</span>
                <span className="text-white capitalize">{status.status}</span>
              </div>
              {status.marketsSynced !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Markets:</span>
                  <span className="text-white">{status.marketsSynced}</span>
                </div>
              )}
              {status.arbsDetected !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Arbs found:</span>
                  <span className="text-profit-mid">{status.arbsDetected}</span>
                </div>
              )}
              {status.completedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Completed:</span>
                  <span className="text-white">{formatRelativeTime(new Date(status.completedAt))}</span>
                </div>
              )}
              {status.errorMessage && (
                <div className="pt-2 border-t border-terminal-border">
                  <span className="text-loss-mid text-xs">{status.errorMessage}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sync button */}
      <button
        onClick={triggerSync}
        disabled={isRunning || triggering}
        className={cn(
          'flex items-center gap-2 px-4 py-2 rounded-lg border transition-all',
          isRunning || triggering
            ? 'bg-terminal-card border-terminal-border text-gray-500 cursor-not-allowed'
            : isStale
              ? 'bg-accent-amber/20 border-accent-amber/30 text-accent-amber hover:bg-accent-amber/30'
              : 'bg-terminal-card border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover'
        )}
      >
        <RefreshCcw className={cn('w-4 h-4', (isRunning || triggering) && 'animate-spin')} />
        {triggering ? 'Checking...' : isRunning ? 'Syncing...' : 'Check Arbs'}
      </button>
    </div>
  );
}
