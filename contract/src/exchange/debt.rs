use near_sdk::AccountId;

use crate::math::{margin_requirement, quote_atoms, quote_per_lot, unrealized_pnl, worst_lots};

use super::error::ExchangeError;
use super::types::Trader;
use super::Exchange;

/// Unrealized profit counts at half its value toward a loan. Losses count in full.
const PROFIT_HAIRCUT_BPS: i128 = 5_000;

impl Exchange {
    /// Quote atoms this trader can still add as debt and keep initial margin.
    pub fn borrow_limit(&self, trader: &AccountId) -> Result<u128, ExchangeError> {
        if self.market.mark_ticks == 0 {
            return Err(ExchangeError::MarkNotSet);
        }
        let account = self.traders.get(trader).cloned().unwrap_or_default();
        let mark_quote = quote_per_lot(self.market.mark_ticks, self.market.tick_size)
            .ok_or(ExchangeError::Overflow)?;
        let unrealized = unrealized_pnl(account.base_lots, account.entry_quote_per_lot, mark_quote)
            .ok_or(ExchangeError::Overflow)?;
        let counted = if unrealized > 0 {
            unrealized * PROFIT_HAIRCUT_BPS / 10_000
        } else {
            unrealized
        };
        let notional = quote_atoms(
            worst_lots(
                account.base_lots,
                account.open_bid_lots,
                account.open_ask_lots,
            ),
            self.market.mark_ticks,
            self.market.tick_size,
        )
        .ok_or(ExchangeError::Overflow)?;
        let initial = margin_requirement(notional, self.market.initial_margin_bps)
            .ok_or(ExchangeError::Overflow)?;
        let room = i128::try_from(account.collateral)
            .map_err(|_| ExchangeError::Overflow)?
            .checked_add(counted)
            .and_then(|value| value.checked_sub(i128::try_from(account.debt).ok()?))
            .and_then(|value| value.checked_sub(i128::try_from(initial).ok()?))
            .ok_or(ExchangeError::Overflow)?;
        Ok(u128::try_from(room.max(0)).unwrap_or(0))
    }

    /// Record new debt. The caller pays out the cash.
    pub fn add_debt(&mut self, trader: &AccountId, gross: u128) -> Result<(), ExchangeError> {
        if gross == 0 {
            return Err(ExchangeError::ZeroSize);
        }
        if self.mark_is_stale(self.observed_ns) {
            return Err(ExchangeError::MarkStale);
        }
        if gross > self.borrow_limit(trader)? {
            return Err(ExchangeError::InsufficientMargin);
        }
        let account = self
            .traders
            .get_mut(trader)
            .ok_or(ExchangeError::InsufficientMargin)?;
        account.debt = account
            .debt
            .checked_add(gross)
            .ok_or(ExchangeError::Overflow)?;
        Ok(())
    }

    /// Lower debt by up to `amount`. Returns the atoms applied.
    pub fn repay_debt(&mut self, trader: &AccountId, amount: u128) -> Result<u128, ExchangeError> {
        let account = self
            .traders
            .get_mut(trader)
            .ok_or(ExchangeError::ZeroSize)?;
        let applied = account.debt.min(amount);
        if applied == 0 {
            return Err(ExchangeError::ZeroSize);
        }
        account.debt -= applied;
        Ok(applied)
    }

    /// Take the whole account out of the book for a gift claim.
    pub fn take_account(&mut self, trader: &AccountId) -> Result<Trader, ExchangeError> {
        self.accrue_funding(self.observed_ns)?;
        self.settle_account(trader)?;
        self.clear_resting(trader)?;
        let mut account = self.traders.remove(trader).unwrap_or_default();
        account.open_bid_lots = 0;
        account.open_ask_lots = 0;
        let mut empty = Trader::default();
        empty.last_funding_index = self.market.funding_index;
        self.traders.insert(trader.clone(), empty);
        Ok(account)
    }

    /// Place a whole account on a flat recipient. Collateral already there is kept.
    pub fn give_account(
        &mut self,
        recipient: &AccountId,
        mut gift: Trader,
    ) -> Result<(), ExchangeError> {
        self.settle_account(recipient)?;
        let current = self.traders.get(recipient).cloned().unwrap_or_default();
        if current.base_lots != 0
            || current.open_bid_lots != 0
            || current.open_ask_lots != 0
            || current.debt != 0
        {
            return Err(ExchangeError::RecipientNotFlat);
        }
        gift.collateral = gift
            .collateral
            .checked_add(current.collateral)
            .ok_or(ExchangeError::Overflow)?;
        gift.last_funding_index = self.market.funding_index;
        self.traders.insert(recipient.clone(), gift);
        self.recompute_open_interest()
    }

    /// Debt repaid to the pool during liquidation since the last collection.
    pub fn collect_pool_repaid(&mut self) -> u128 {
        std::mem::take(&mut self.market.pool_repaid)
    }
}
