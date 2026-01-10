import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { loadFees } from '@/lib/fees';

export async function GET() {
  try {
    const result = await query<{
      platform: string;
      taker_fee_pct: string;
      maker_fee_pct: string;
      settlement_fee_pct: string;
      withdrawal_fee_flat: string;
      fee_notes: string;
      last_verified_at: Date;
      updated_at: Date;
    }>('SELECT * FROM platform_config ORDER BY platform');

    const history = await query<{
      platform: string;
      field_changed: string;
      old_value: string;
      new_value: string;
      changed_at: Date;
      change_reason: string;
    }>('SELECT * FROM platform_fee_history ORDER BY changed_at DESC LIMIT 50');

    return NextResponse.json({
      configs: result.rows.map(r => ({
        platform: r.platform,
        takerFeePct: parseFloat(r.taker_fee_pct),
        makerFeePct: parseFloat(r.maker_fee_pct),
        settlementFeePct: parseFloat(r.settlement_fee_pct),
        withdrawalFeeFlat: parseFloat(r.withdrawal_fee_flat),
        feeNotes: r.fee_notes,
        lastVerifiedAt: r.last_verified_at,
        updatedAt: r.updated_at,
      })),
      history: history.rows.map(h => ({
        platform: h.platform,
        fieldChanged: h.field_changed,
        oldValue: parseFloat(h.old_value),
        newValue: parseFloat(h.new_value),
        changedAt: h.changed_at,
        changeReason: h.change_reason,
      })),
    });
  } catch (error) {
    console.error('Fees API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fee configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { platform, takerFeePct, makerFeePct, settlementFeePct, reason } = body;

    if (!platform) {
      return NextResponse.json({ error: 'Platform required' }, { status: 400 });
    }

    // Get current values
    const current = await query<{
      taker_fee_pct: string;
      maker_fee_pct: string;
      settlement_fee_pct: string;
    }>('SELECT taker_fee_pct, maker_fee_pct, settlement_fee_pct FROM platform_config WHERE platform = $1', [platform]);

    if (current.rows.length === 0) {
      return NextResponse.json({ error: 'Platform not found' }, { status: 404 });
    }

    const oldValues = current.rows[0];
    const updates: string[] = [];
    const historyInserts: { field: string; oldVal: string; newVal: number }[] = [];

    if (takerFeePct !== undefined && parseFloat(oldValues.taker_fee_pct) !== takerFeePct) {
      updates.push(`taker_fee_pct = ${takerFeePct}`);
      historyInserts.push({ field: 'taker_fee_pct', oldVal: oldValues.taker_fee_pct, newVal: takerFeePct });
    }

    if (makerFeePct !== undefined && parseFloat(oldValues.maker_fee_pct) !== makerFeePct) {
      updates.push(`maker_fee_pct = ${makerFeePct}`);
      historyInserts.push({ field: 'maker_fee_pct', oldVal: oldValues.maker_fee_pct, newVal: makerFeePct });
    }

    if (settlementFeePct !== undefined && parseFloat(oldValues.settlement_fee_pct) !== settlementFeePct) {
      updates.push(`settlement_fee_pct = ${settlementFeePct}`);
      historyInserts.push({ field: 'settlement_fee_pct', oldVal: oldValues.settlement_fee_pct, newVal: settlementFeePct });
    }

    if (updates.length === 0) {
      return NextResponse.json({ message: 'No changes' });
    }

    // Update config
    await query(
      `UPDATE platform_config SET ${updates.join(', ')}, updated_at = NOW(), last_verified_at = NOW() WHERE platform = $1`,
      [platform]
    );

    // Insert history
    for (const h of historyInserts) {
      await query(
        `INSERT INTO platform_fee_history (platform, field_changed, old_value, new_value, change_reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [platform, h.field, h.oldVal, h.newVal, reason || null]
      );
    }

    // Reload fee cache
    await loadFees();

    return NextResponse.json({ success: true, updated: historyInserts.length });
  } catch (error) {
    console.error('Fees update error:', error);
    return NextResponse.json(
      { error: 'Failed to update fee configuration' },
      { status: 500 }
    );
  }
}
