'use client';

import { useEffect, useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { RefreshCcw, Save, History, AlertCircle, CheckCircle } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';

interface FeeConfig {
  platform: string;
  takerFeePct: number;
  makerFeePct: number;
  settlementFeePct: number;
  withdrawalFeeFlat: number;
  feeNotes: string;
  lastVerifiedAt: string | null;
  updatedAt: string;
}

interface FeeHistoryItem {
  platform: string;
  fieldChanged: string;
  oldValue: number;
  newValue: number;
  changedAt: string;
  changeReason: string | null;
}

export default function SettingsPage() {
  const [configs, setConfigs] = useState<FeeConfig[]>([]);
  const [history, setHistory] = useState<FeeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [editedFees, setEditedFees] = useState<Record<string, { taker: string; maker: string }>>({});
  const [changeReason, setChangeReason] = useState('');

  const fetchFees = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/fees');
      const data = await res.json();
      
      setConfigs(data.configs || []);
      setHistory(data.history || []);
      
      // Initialize edit state
      const initial: Record<string, { taker: string; maker: string }> = {};
      for (const c of data.configs || []) {
        initial[c.platform] = {
          taker: (c.takerFeePct * 100).toFixed(2),
          maker: (c.makerFeePct * 100).toFixed(2),
        };
      }
      setEditedFees(initial);
    } catch (err) {
      console.error('Failed to fetch fees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFees();
  }, []);

  const handleSave = async (platform: string) => {
    try {
      setSaving(true);
      setSaveStatus('idle');
      
      const edited = editedFees[platform];
      const takerFeePct = parseFloat(edited.taker) / 100;
      const makerFeePct = parseFloat(edited.maker) / 100;
      
      const res = await fetch('/api/fees', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          takerFeePct,
          makerFeePct,
          reason: changeReason || undefined,
        }),
      });
      
      if (!res.ok) {
        throw new Error('Failed to save');
      }
      
      setSaveStatus('success');
      setChangeReason('');
      await fetchFees();
      
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Failed to save fees:', err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = (platform: string) => {
    const config = configs.find((c) => c.platform === platform);
    const edited = editedFees[platform];
    if (!config || !edited) return false;
    
    return (
      parseFloat(edited.taker) !== config.takerFeePct * 100 ||
      parseFloat(edited.maker) !== config.makerFeePct * 100
    );
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      
      <main className="pt-20 pb-8 px-4 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Settings</h1>
            <p className="text-gray-400 text-sm mt-1">
              Configure platform fees and system preferences
            </p>
          </div>
          <button
            onClick={fetchFees}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-terminal-card border border-terminal-border text-gray-400 hover:text-white hover:bg-terminal-hover transition-all disabled:opacity-50"
          >
            <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Fee Configuration */}
        <div className="card mb-8">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-medium text-white">Platform Fee Configuration</h2>
            {saveStatus === 'success' && (
              <span className="flex items-center gap-1 text-sm text-profit-low">
                <CheckCircle className="w-4 h-4" />
                Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="flex items-center gap-1 text-sm text-loss-mid">
                <AlertCircle className="w-4 h-4" />
                Failed to save
              </span>
            )}
          </div>
          <div className="card-body space-y-6">
            {loading ? (
              <div className="animate-pulse space-y-4">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-24 bg-terminal-hover rounded" />
                ))}
              </div>
            ) : (
              configs.map((config) => (
                <div
                  key={config.platform}
                  className={cn(
                    'p-4 rounded-lg border transition-all',
                    hasChanges(config.platform)
                      ? 'border-accent-cyan/50 bg-accent-cyan/5'
                      : 'border-terminal-border bg-terminal-bg'
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className={cn(
                        'font-medium capitalize',
                        config.platform === 'polymarket' ? 'text-purple-400' : 'text-blue-400'
                      )}>
                        {config.platform}
                      </h3>
                      {config.feeNotes && (
                        <p className="text-xs text-gray-500 mt-1">{config.feeNotes}</p>
                      )}
                    </div>
                    {config.lastVerifiedAt && (
                      <span className="text-xs text-gray-500">
                        Last verified: {formatRelativeTime(new Date(config.lastVerifiedAt))}
                      </span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">
                        Taker Fee (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={editedFees[config.platform]?.taker || ''}
                        onChange={(e) =>
                          setEditedFees({
                            ...editedFees,
                            [config.platform]: {
                              ...editedFees[config.platform],
                              taker: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-terminal-card border border-terminal-border text-white font-mono focus:outline-none focus:border-accent-cyan"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1.5">
                        Maker Fee (%)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={editedFees[config.platform]?.maker || ''}
                        onChange={(e) =>
                          setEditedFees({
                            ...editedFees,
                            [config.platform]: {
                              ...editedFees[config.platform],
                              maker: e.target.value,
                            },
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg bg-terminal-card border border-terminal-border text-white font-mono focus:outline-none focus:border-accent-cyan"
                      />
                    </div>
                  </div>
                  
                  {hasChanges(config.platform) && (
                    <div className="flex items-center gap-4">
                      <input
                        type="text"
                        placeholder="Reason for change (optional)"
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg bg-terminal-card border border-terminal-border text-white text-sm focus:outline-none focus:border-accent-cyan"
                      />
                      <button
                        onClick={() => handleSave(config.platform)}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-cyan text-terminal-bg font-medium text-sm hover:bg-accent-cyan/90 transition-all disabled:opacity-50"
                      >
                        <Save className="w-4 h-4" />
                        Save Changes
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Fee History */}
        <div className="card">
          <div className="card-header flex items-center gap-2">
            <History className="w-4 h-4 text-gray-400" />
            <h2 className="font-medium text-white">Fee Change History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Field</th>
                  <th className="text-right">Old Value</th>
                  <th className="text-right">New Value</th>
                  <th>Reason</th>
                  <th>Changed</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-500">
                      No fee changes recorded
                    </td>
                  </tr>
                ) : (
                  history.map((item, i) => (
                    <tr key={i}>
                      <td>
                        <span className={cn(
                          'capitalize',
                          item.platform === 'polymarket' ? 'text-purple-400' : 'text-blue-400'
                        )}>
                          {item.platform}
                        </span>
                      </td>
                      <td className="text-gray-400">
                        {item.fieldChanged.replace('_', ' ')}
                      </td>
                      <td className="text-right font-mono text-gray-400">
                        {(item.oldValue * 100).toFixed(2)}%
                      </td>
                      <td className="text-right font-mono text-white">
                        {(item.newValue * 100).toFixed(2)}%
                      </td>
                      <td className="text-gray-500 text-sm">
                        {item.changeReason || '-'}
                      </td>
                      <td className="text-gray-500 text-sm">
                        {formatRelativeTime(new Date(item.changedAt))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
