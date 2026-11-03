use super::error::ExchangeError;
use super::Exchange;

const MAX_MARK_MOVE_BPS: u128 = 2_500;

const CONFIRM_BPS: u128 = 100;

impl Exchange {
    pub fn push_mark(&mut self, mark_ticks: u64, index_ticks: u64) -> Result<(), ExchangeError> {
        if mark_ticks == 0 || index_ticks == 0 {
            return Err(ExchangeError::ZeroPrice);
        }
        let in_band = within(self.market.mark_ticks, mark_ticks, MAX_MARK_MOVE_BPS)
            && within(self.market.index_ticks, index_ticks, MAX_MARK_MOVE_BPS);
        let confirmed = self.market.pending_mark_ticks != 0
            && within(self.market.pending_mark_ticks, mark_ticks, CONFIRM_BPS)
            && within(self.market.pending_index_ticks, index_ticks, CONFIRM_BPS);
        if in_band || confirmed {
            self.market.pending_mark_ticks = 0;
            self.market.pending_index_ticks = 0;
            self.market.mark_ticks = mark_ticks;
            self.market.index_ticks = index_ticks;
            return Ok(());
        }
        self.market.pending_mark_ticks = mark_ticks;
        self.market.pending_index_ticks = index_ticks;
        Err(ExchangeError::MarkDeviation)
    }
}

fn within(previous: u64, next: u64, band_bps: u128) -> bool {
    if previous == 0 {
        return true;
    }
    let diff = (next as i128 - previous as i128).unsigned_abs();
    diff * 10_000 <= previous as u128 * band_bps
}
