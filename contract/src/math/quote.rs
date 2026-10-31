pub fn quote_per_lot(ticks: u64, tick_size: u128) -> Option<u128> {
    (ticks as u128).checked_mul(tick_size)
}

pub fn quote_atoms(lots: u64, ticks: u64, tick_size: u128) -> Option<u128> {
    (lots as u128).checked_mul(quote_per_lot(ticks, tick_size)?)
}
