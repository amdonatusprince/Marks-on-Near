use near_sdk::AccountId;

use super::error::ExchangeError;
use super::Exchange;

impl Exchange {
    pub fn credit(&mut self, trader: &AccountId, amount: u128) -> Result<(), ExchangeError> {
        if amount == 0 {
            return Err(ExchangeError::ZeroSize);
        }
        let mut account = self.traders.get(trader).cloned().unwrap_or_default();
        account.collateral = account
            .collateral
            .checked_add(amount)
            .ok_or(ExchangeError::Overflow)?;
        self.traders.insert(trader.clone(), account);
        Ok(())
    }

    #[allow(dead_code)] // published once the collateral token transfer exists
    pub fn withdraw(&mut self, trader: &AccountId, amount: u128) -> Result<(), ExchangeError> {
        if amount == 0 {
            return Err(ExchangeError::ZeroSize);
        }
        let mut account = self
            .traders
            .get(trader)
            .cloned()
            .ok_or(ExchangeError::InsufficientCollateral)?;
        if account.collateral < amount {
            return Err(ExchangeError::InsufficientCollateral);
        }
        account.collateral -= amount;
        self.ensure_margin(&account)?;
        self.traders.insert(trader.clone(), account);
        Ok(())
    }
}
