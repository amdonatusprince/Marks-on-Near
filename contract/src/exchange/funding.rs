use near_sdk::AccountId;

use crate::math::{funding_payment, funding_rate_bps};

use super::error::ExchangeError;
use super::types::Trader;
use super::Exchange;

const MAX_INTERVALS_PER_CALL: u64 = 24;

impl Exchange {
    /// Move the funding index forward by at most 24 elapsed intervals.
    pub fn accrue_funding(&mut self, now_ns: u64) -> Result<u64, ExchangeError> {
        if self.market.funding_interval_ns == 0 {
            return Err(ExchangeError::InvalidMarket("funding interval"));
        }
        if self.market.last_funding_ns == 0 {
            self.market.last_funding_ns = now_ns;
            return Ok(0);
        }
        if now_ns <= self.market.last_funding_ns {
            return Ok(0);
        }
        let elapsed = now_ns - self.market.last_funding_ns;
        let ready = elapsed / self.market.funding_interval_ns;
        let intervals = ready.min(MAX_INTERVALS_PER_CALL);
        if intervals == 0 {
            return Ok(0);
        }
        let rate = funding_rate_bps(
            self.market.mark_ticks,
            self.market.index_ticks,
            self.market.max_funding_bps,
        )
        .ok_or(ExchangeError::Overflow)?;
        let per_lot = funding_payment(1, self.market.index_ticks, self.market.tick_size, rate)
            .ok_or(ExchangeError::Overflow)?;
        let step = per_lot
            .checked_mul(i128::try_from(intervals).map_err(|_| ExchangeError::Overflow)?)
            .ok_or(ExchangeError::Overflow)?;
        self.market.funding_index = self
            .market
            .funding_index
            .checked_add(step)
            .ok_or(ExchangeError::Overflow)?;
        self.market.last_funding_ns = self
            .market
            .last_funding_ns
            .checked_add(
                intervals
                    .checked_mul(self.market.funding_interval_ns)
                    .ok_or(ExchangeError::Overflow)?,
            )
            .ok_or(ExchangeError::Overflow)?;
        Ok(intervals)
    }

    /// Charge this trader the funding index movement since they last settled.
    pub fn settle_account(&mut self, trader: &AccountId) -> Result<i128, ExchangeError> {
        let mut account = self.traders.get(trader).cloned().unwrap_or_else(|| Trader {
            last_funding_index: self.market.funding_index,
            ..Trader::default()
        });
        let delta = self
            .market
            .funding_index
            .checked_sub(account.last_funding_index)
            .ok_or(ExchangeError::Overflow)?;
        let mut payment = 0i128;
        if account.base_lots != 0 && delta != 0 {
            payment = (account.base_lots as i128)
                .checked_mul(delta)
                .ok_or(ExchangeError::Overflow)?;
            let (collateral, unpaid) = apply_payment(account.collateral, payment)?;
            account.collateral = collateral;
            self.market.bad_debt = self
                .market
                .bad_debt
                .checked_add(unpaid)
                .ok_or(ExchangeError::Overflow)?;
        }
        account.last_funding_index = self.market.funding_index;
        self.traders.insert(trader.clone(), account);
        Ok(payment)
    }

    pub fn settle_funding(&mut self, trader: &AccountId) -> Result<i128, ExchangeError> {
        self.accrue_funding(self.observed_ns)?;
        self.settle_account(trader)
    }
}

/// Positive payment reduces collateral. Returns the unpaid amount when the balance runs out.
fn apply_payment(collateral: u128, payment: i128) -> Result<(u128, u128), ExchangeError> {
    if payment > 0 {
        let due = payment as u128;
        if collateral >= due {
            Ok((collateral - due, 0))
        } else {
            Ok((0, due - collateral))
        }
    } else {
        let credit = payment.unsigned_abs();
        Ok((
            collateral
                .checked_add(credit)
                .ok_or(ExchangeError::Overflow)?,
            0,
        ))
    }
}
