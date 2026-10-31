/// `q × (mark − entry)`, in quote atoms.
pub fn unrealized_pnl(
    base_lots: i64,
    entry_quote_per_lot: u128,
    mark_quote_per_lot: u128,
) -> Option<i128> {
    if base_lots == 0 {
        return Some(0);
    }
    let entry = i128::try_from(entry_quote_per_lot).ok()?;
    let mark = i128::try_from(mark_quote_per_lot).ok()?;
    (base_lots as i128).checked_mul(mark.checked_sub(entry)?)
}

pub fn equity(collateral: u128, unrealized_pnl: i128) -> Option<i128> {
    i128::try_from(collateral).ok()?.checked_add(unrealized_pnl)
}
