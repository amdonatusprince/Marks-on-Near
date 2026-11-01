use super::error::ExchangeError;
use super::Exchange;

const MAX_MARK_MOVE_BPS: u128 = 2_500;

impl Exchange {
    pub fn push_mark(&mut self, mark_ticks: u64, index_ticks: u64) -> Result<(), ExchangeError> {
        if mark_ticks == 0 || index_ticks == 0 {
            return Err(ExchangeError::ZeroPrice);
        }
        within_mark_band(self.market.mark_ticks, mark_ticks)?;
        within_mark_band(self.market.index_ticks, index_ticks)?;
        self.market.mark_ticks = mark_ticks;
        self.market.index_ticks = index_ticks;
        Ok(())
    }
}

fn within_mark_band(previous: u64, next: u64) -> Result<(), ExchangeError> {
    if previous == 0 {
        return Ok(());
    }
    let diff = (next as i128 - previous as i128).unsigned_abs();
    if diff * 10_000 > previous as u128 * MAX_MARK_MOVE_BPS {
        return Err(ExchangeError::MarkDeviation);
    }
    Ok(())
}
