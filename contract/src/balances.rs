//! Unallocated USDC balances, the platform fee, and NEP-297 events.

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::Marks;

/// One percent, charged on loans and gifts.
pub const PLATFORM_FEE_BPS: u128 = 100;

/// One percent of `amount`, rounded up so a small amount still pays a fee.
pub fn platform_fee(amount: u128) -> u128 {
    amount
        .checked_mul(PLATFORM_FEE_BPS)
        .unwrap_or_else(|| env::panic_str("overflow"))
        .div_ceil(10_000)
}

pub fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "marks", "version": "2.0.0", "event": event, "data": [data] })
    ));
}

impl Marks {
    pub(crate) fn balance_of(&self, account: &AccountId) -> u128 {
        self.unallocated.get(account).copied().unwrap_or(0)
    }

    pub(crate) fn credit_unallocated(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let balance = self.balance_of(account);
        self.unallocated.insert(
            account.clone(),
            balance
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("overflow")),
        );
    }

    pub(crate) fn take_unallocated(&mut self, account: &AccountId, amount: u128) {
        if amount == 0 {
            env::panic_str("size is zero");
        }
        let balance = self.balance_of(account);
        if balance < amount {
            env::panic_str("insufficient collateral");
        }
        let left = balance - amount;
        if left == 0 {
            self.unallocated.remove(account);
        } else {
            self.unallocated.insert(account.clone(), left);
        }
    }

    /// Move a fee from the payer's unallocated balance to the fee account.
    pub(crate) fn charge_fee(&mut self, payer: &AccountId, fee: u128) {
        if fee == 0 {
            return;
        }
        self.take_unallocated(payer, fee);
        let fee_account = self.fee_account.clone();
        self.credit_unallocated(&fee_account, fee);
    }

    /// Route a deposit by `msg`: empty for the wallet, `pool` for the lending
    /// pool, `desk` for the share desk.
    pub(crate) fn route_deposit(&mut self, sender: AccountId, amount: u128, msg: &str) {
        match msg.trim() {
            "" | "deposit" => self.credit_unallocated(&sender, amount),
            "pool" => self.supply_pool(&sender, amount),
            "desk" => {
                self.shares.desk_cash = self
                    .shares
                    .desk_cash
                    .checked_add(amount)
                    .unwrap_or_else(|| env::panic_str("overflow"));
                emit(
                    "desk_funded",
                    json!({ "account_id": sender, "amount": amount.to_string() }),
                );
            }
            _ => env::panic_str("unknown deposit route"),
        }
    }
}
