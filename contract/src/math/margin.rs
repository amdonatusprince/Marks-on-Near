/// Notional × bps / 10_000, rounded down.
pub fn margin_requirement(notional: u128, bps: u32) -> Option<u128> {
    notional.checked_mul(bps as u128)?.checked_div(10_000)
}

/// Collateral that can leave without pulling equity through initial margin.
pub fn free_collateral(collateral: u128, equity: i128, initial_margin: u128) -> u128 {
    let Ok(initial) = i128::try_from(initial_margin) else {
        return 0;
    };
    if equity <= initial {
        return 0;
    }
    let room = (equity - initial) as u128;
    room.min(collateral)
}

/// Larger absolute position after either every resting bid fills or every resting ask fills.
pub fn worst_lots(base_lots: i64, open_bid_lots: u64, open_ask_lots: u64) -> u64 {
    let base = base_lots as i128;
    let long_fill = base.saturating_add(open_bid_lots as i128).unsigned_abs();
    let short_fill = base.saturating_sub(open_ask_lots as i128).unsigned_abs();
    long_fill.max(short_fill) as u64
}

/// Mark, in quote atoms per lot, where equity equals maintenance margin.
///
/// Long: `(C − qE) × 10_000 / (q × (m − 10_000))`.
/// Short: `(C − qE) × 10_000 / (−q × (m + 10_000))`.
pub fn liquidation_quote_per_lot(
    collateral: u128,
    base_lots: i64,
    entry_quote_per_lot: u128,
    maintenance_bps: u32,
) -> Option<u128> {
    if base_lots == 0 || maintenance_bps >= 10_000 {
        return None;
    }
    let q = base_lots as i128;
    let collateral = i128::try_from(collateral).ok()?;
    let entry = i128::try_from(entry_quote_per_lot).ok()?;
    let maintenance = maintenance_bps as i128;
    let numerator = collateral
        .checked_sub(q.checked_mul(entry)?)?
        .checked_mul(10_000)?;
    let denominator = if q > 0 {
        q.checked_mul(maintenance.checked_sub(10_000)?)?
    } else {
        q.checked_neg()?
            .checked_mul(maintenance.checked_add(10_000)?)?
    };
    if denominator == 0 {
        return None;
    }
    u128::try_from(numerator.checked_div(denominator)?).ok()
}
