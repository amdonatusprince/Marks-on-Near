use super::quote_per_lot;

/// Clamp `(mark − index) / index` to ±max, in basis points.
pub fn funding_rate_bps(mark_ticks: u64, index_ticks: u64, max_bps: u32) -> Option<i64> {
    if index_ticks == 0 {
        return Some(0);
    }
    let premium = (mark_ticks as i128 - index_ticks as i128)
        .checked_mul(10_000)?
        .checked_div(index_ticks as i128)?;
    let cap = max_bps as i128;
    i64::try_from(premium.clamp(-cap, cap)).ok()
}

/// Signed funding charge. Positive means the trader pays.
pub fn funding_payment(
    base_lots: i64,
    index_ticks: u64,
    tick_size: u128,
    rate_bps: i64,
) -> Option<i128> {
    let index_quote = i128::try_from(quote_per_lot(index_ticks, tick_size)?).ok()?;
    (base_lots as i128)
        .checked_mul(index_quote)?
        .checked_mul(rate_bps as i128)?
        .checked_div(10_000)
}
