use near_sdk::AccountId;

use crate::math::{
    self, equity, free_collateral, margin_requirement, quote_atoms, quote_per_lot, unrealized_pnl,
    worst_lots,
};

use super::error::ExchangeError;
use super::types::{Trader, TraderState};
use super::Exchange;

impl Exchange {
    pub fn trader_state(&self, trader: &AccountId) -> Result<TraderState, ExchangeError> {
        let account = self.traders.get(trader).cloned().unwrap_or_default();
        let mark_quote = quote_per_lot(self.market.mark_ticks, self.market.tick_size)
            .ok_or(ExchangeError::Overflow)?;
        let unrealized = if self.market.mark_ticks == 0 {
            0
        } else {
            unrealized_pnl(account.base_lots, account.entry_quote_per_lot, mark_quote)
                .ok_or(ExchangeError::Overflow)?
        };
        let equity = equity(account.collateral, unrealized).ok_or(ExchangeError::Overflow)?;
        let position_notional = quote_atoms(
            account.base_lots.unsigned_abs(),
            self.market.mark_ticks,
            self.market.tick_size,
        )
        .ok_or(ExchangeError::Overflow)?;
        let worst_notional = quote_atoms(
            worst_lots(
                account.base_lots,
                account.open_bid_lots,
                account.open_ask_lots,
            ),
            self.market.mark_ticks,
            self.market.tick_size,
        )
        .ok_or(ExchangeError::Overflow)?;
        let initial_margin = margin_requirement(worst_notional, self.market.initial_margin_bps)
            .ok_or(ExchangeError::Overflow)?;
        let maintenance_margin =
            margin_requirement(position_notional, self.market.maintenance_margin_bps)
                .ok_or(ExchangeError::Overflow)?;
        Ok(TraderState {
            collateral: account.collateral,
            base_lots: account.base_lots,
            entry_quote_per_lot: account.entry_quote_per_lot,
            unrealized_pnl: unrealized,
            equity,
            initial_margin,
            maintenance_margin,
            free_collateral: free_collateral(account.collateral, equity, initial_margin),
            liquidation_quote_per_lot: math::liquidation_quote_per_lot(
                account.collateral,
                account.base_lots,
                account.entry_quote_per_lot,
                self.market.maintenance_margin_bps,
            ),
            open_bid_lots: account.open_bid_lots,
            open_ask_lots: account.open_ask_lots,
        })
    }

    pub(super) fn ensure_margin(&self, trader: &Trader) -> Result<(), ExchangeError> {
        if self.market.mark_ticks == 0 {
            return Err(ExchangeError::MarkNotSet);
        }
        let mark_quote = quote_per_lot(self.market.mark_ticks, self.market.tick_size)
            .ok_or(ExchangeError::Overflow)?;
        let unrealized = unrealized_pnl(trader.base_lots, trader.entry_quote_per_lot, mark_quote)
            .ok_or(ExchangeError::Overflow)?;
        let equity = equity(trader.collateral, unrealized).ok_or(ExchangeError::Overflow)?;
        let notional = quote_atoms(
            worst_lots(trader.base_lots, trader.open_bid_lots, trader.open_ask_lots),
            self.market.mark_ticks,
            self.market.tick_size,
        )
        .ok_or(ExchangeError::Overflow)?;
        let initial = margin_requirement(notional, self.market.initial_margin_bps)
            .ok_or(ExchangeError::Overflow)?;
        if equity < initial as i128 {
            return Err(ExchangeError::InsufficientMargin);
        }
        Ok(())
    }
}
