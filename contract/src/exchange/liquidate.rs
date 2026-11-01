use near_sdk::AccountId;

use crate::math::{apply_fill, quote_atoms, quote_per_lot, Position, Side};

use super::error::ExchangeError;
use super::Exchange;

/// One percent of closed notional, paid to whoever submits the liquidation.
const LIQUIDATION_FEE_BPS: u128 = 100;

impl Exchange {
    pub fn liquidate(
        &mut self,
        caller: &AccountId,
        target: &AccountId,
    ) -> Result<(), ExchangeError> {
        self.accrue_funding(self.observed_ns)?;
        self.settle_account(target)?;
        let state = self.trader_state(target)?;
        let maintenance =
            i128::try_from(state.maintenance_margin).map_err(|_| ExchangeError::Overflow)?;
        if state.base_lots == 0 || state.equity >= maintenance {
            return Err(ExchangeError::NotLiquidatable);
        }

        self.clear_resting(target)?;
        let lots = state.base_lots.unsigned_abs();
        let side = if state.base_lots > 0 {
            Side::Ask
        } else {
            Side::Bid
        };
        let quote = quote_per_lot(self.market.mark_ticks, self.market.tick_size)
            .ok_or(ExchangeError::Overflow)?;
        let mut account = self
            .traders
            .get(target)
            .cloned()
            .ok_or(ExchangeError::NotLiquidatable)?;
        let unpaid = close_at_mark(&mut account, side, lots, quote)?;
        let notional = quote_atoms(lots, self.market.mark_ticks, self.market.tick_size)
            .ok_or(ExchangeError::Overflow)?;
        let fee = notional
            .checked_mul(LIQUIDATION_FEE_BPS)
            .ok_or(ExchangeError::Overflow)?
            / 10_000;
        let paid = fee.min(account.collateral);
        account.collateral -= paid;
        account.open_bid_lots = 0;
        account.open_ask_lots = 0;
        self.traders.insert(target.clone(), account);

        if caller != target && paid > 0 {
            let mut reward = self.traders.get(caller).cloned().unwrap_or_default();
            if !self.traders.contains_key(caller) {
                reward.last_funding_index = self.market.funding_index;
            }
            reward.collateral = reward
                .collateral
                .checked_add(paid)
                .ok_or(ExchangeError::Overflow)?;
            self.traders.insert(caller.clone(), reward);
        } else if caller == target && paid > 0 {
            let account = self
                .traders
                .get_mut(target)
                .ok_or(ExchangeError::Overflow)?;
            account.collateral = account
                .collateral
                .checked_add(paid)
                .ok_or(ExchangeError::Overflow)?;
        }

        let covered = unpaid.min(self.market.insurance);
        self.market.insurance -= covered;
        self.market.bad_debt = self
            .market
            .bad_debt
            .checked_add(unpaid - covered)
            .ok_or(ExchangeError::Overflow)?;
        self.recompute_open_interest()
    }
}

fn close_at_mark(
    account: &mut super::Trader,
    side: Side,
    lots: u64,
    quote_per_lot: u128,
) -> Result<u128, ExchangeError> {
    let fill = apply_fill(
        Position {
            base_lots: account.base_lots,
            entry_quote_per_lot: account.entry_quote_per_lot,
        },
        side,
        lots,
        quote_per_lot,
    )
    .ok_or(ExchangeError::Overflow)?;
    account.base_lots = fill.position.base_lots;
    account.entry_quote_per_lot = fill.position.entry_quote_per_lot;
    if fill.realized_pnl >= 0 {
        account.collateral = account
            .collateral
            .checked_add(u128::try_from(fill.realized_pnl).map_err(|_| ExchangeError::Overflow)?)
            .ok_or(ExchangeError::Overflow)?;
        Ok(0)
    } else {
        let loss = fill.realized_pnl.unsigned_abs();
        if account.collateral >= loss {
            account.collateral -= loss;
            Ok(0)
        } else {
            let unpaid = loss - account.collateral;
            account.collateral = 0;
            Ok(unpaid)
        }
    }
}
