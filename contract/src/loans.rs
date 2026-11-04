//! The lending pool and the two loans it funds.
//!
//! Perp loan: debt sits on the position. The limit is collateral plus half of
//! unrealized profit, minus losses, minus debt, minus initial margin.
//! Liquidation repays the pool before the liquidator or the trader.
//!
//! Share loan: shares move into the loan. Debt can reach 50 percent of their
//! value at the mark. Above 65 percent anyone can sell them to the desk; the
//! pool is repaid first and the caller earns 1 percent of the sale.

use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId};

use crate::balances::{emit, platform_fee};
use crate::shares::{value_of, ShareLoan};
use crate::{Marks, MarksExt};

pub const SHARE_LTV_BPS: u128 = 5_000;
pub const SHARE_LIQUIDATION_BPS: u128 = 6_500;
const LOAN_LIQUIDATOR_BPS: u128 = 100;

#[near(serializers = [borsh])]
#[derive(Default)]
pub struct Pool {
    pub cash: u128,
    pub lent: u128,
    pub fees: u128,
    pub bad_debt: u128,
    pub supplied: BTreeMap<AccountId, u128>,
}

#[near(serializers = [json])]
pub struct PoolView {
    pub cash: U128,
    pub lent: U128,
    pub fees: U128,
    pub bad_debt: U128,
}

impl Marks {
    pub(crate) fn supply_pool(&mut self, supplier: &AccountId, amount: u128) {
        self.pool.cash = self
            .pool
            .cash
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("overflow"));
        let supplied = self.pool.supplied.get(supplier).copied().unwrap_or(0);
        self.pool
            .supplied
            .insert(supplier.clone(), supplied + amount);
        emit(
            "pool_supplied",
            json!({ "account_id": supplier, "amount": amount.to_string() }),
        );
    }

    /// Pay out `amount` to the borrower and the fee to the fee account. Returns the gross debt.
    fn lend(&mut self, borrower: &AccountId, amount: u128) -> u128 {
        if amount == 0 {
            env::panic_str("size is zero");
        }
        let fee = platform_fee(amount);
        let gross = amount + fee;
        if self.pool.cash < gross {
            env::panic_str("pool is short");
        }
        self.pool.cash -= gross;
        self.pool.lent += gross;
        self.pool.fees += fee;
        self.credit_unallocated(borrower, amount);
        let fee_account = self.fee_account.clone();
        self.credit_unallocated(&fee_account, fee);
        gross
    }

    fn receive_repayment(&mut self, amount: u128) {
        self.pool.cash = self
            .pool
            .cash
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("overflow"));
        self.pool.lent = self.pool.lent.saturating_sub(amount);
    }

    /// Book a liquidation's debt result: what came back and what was lost.
    pub(crate) fn settle_liquidated_debt(&mut self, debt_before: u128, repaid: u128) {
        self.receive_repayment(repaid);
        let lost = debt_before.saturating_sub(repaid);
        self.pool.lent = self.pool.lent.saturating_sub(lost);
        self.pool.bad_debt += lost;
    }

    fn share_loan(&self, account: &AccountId, asset_id: &str) -> ShareLoan {
        self.shares
            .loans
            .get(account)
            .and_then(|loans| loans.get(asset_id))
            .cloned()
            .unwrap_or_default()
    }

    fn put_share_loan(&mut self, account: &AccountId, asset_id: &str, loan: ShareLoan) {
        let loans = self.shares.loans.entry(account.clone()).or_default();
        if loan.units.0 == 0 && loan.debt.0 == 0 {
            loans.remove(asset_id);
        } else {
            loans.insert(asset_id.to_string(), loan);
        }
        if loans.is_empty() {
            self.shares.loans.remove(account);
        }
    }
}

#[near]
impl Marks {
    /// Return supplied USDC that the pool has not lent out.
    pub fn withdraw_supply(&mut self, amount: U128) {
        let supplier = env::predecessor_account_id();
        let supplied = self.pool.supplied.get(&supplier).copied().unwrap_or(0);
        if amount.0 == 0 || supplied < amount.0 {
            env::panic_str("insufficient supply");
        }
        if self.pool.cash < amount.0 {
            env::panic_str("pool is short");
        }
        self.pool.cash -= amount.0;
        self.pool
            .supplied
            .insert(supplier.clone(), supplied - amount.0);
        self.credit_unallocated(&supplier, amount.0);
    }

    /// Borrow USDC against an open perp. Debt is `amount` plus the 1 percent fee.
    pub fn borrow(&mut self, symbol: String, amount: U128) -> U128 {
        let trader = env::predecessor_account_id();
        self.ensure_not_gifted(&symbol, &trader);
        let fee = platform_fee(amount.0);
        let gross = amount
            .0
            .checked_add(fee)
            .unwrap_or_else(|| env::panic_str("overflow"));
        let book = self.book_mut(&symbol);
        book.note_time(env::block_timestamp());
        crate::must(book.settle_funding(&trader).map(|_| ()));
        crate::must(book.add_debt(&trader, gross));
        self.lend(&trader, amount.0);
        emit(
            "loan_opened",
            json!({ "account_id": trader, "symbol": symbol, "amount": amount.0.to_string(), "fee": fee.to_string() }),
        );
        U128(gross)
    }

    /// Repay perp debt from the unallocated balance. Returns the atoms applied.
    pub fn repay(&mut self, symbol: String, amount: U128) -> U128 {
        let trader = env::predecessor_account_id();
        let owed = self
            .book(&symbol)
            .traders
            .get(&trader)
            .map(|account| account.debt)
            .unwrap_or(0);
        let applied = owed.min(amount.0);
        self.take_unallocated(&trader, applied);
        crate::must(self.book_mut(&symbol).repay_debt(&trader, applied));
        self.receive_repayment(applied);
        emit(
            "loan_repaid",
            json!({ "account_id": trader, "symbol": symbol, "amount": applied.to_string() }),
        );
        U128(applied)
    }

    /// Lock `units` more shares and borrow `amount` against everything locked.
    pub fn borrow_against(&mut self, asset_id: String, units: U128, amount: U128) -> U128 {
        let borrower = env::predecessor_account_id();
        let price = self.shares.fresh_price(&asset_id, env::block_timestamp());
        let mut loan = self.share_loan(&borrower, &asset_id);
        if units.0 > 0 {
            self.shares.remove_units(&borrower, &asset_id, units.0);
            loan.units = U128(loan.units.0 + units.0);
        }
        let fee = platform_fee(amount.0);
        let debt = loan.debt.0 + amount.0 + fee;
        let value = value_of(loan.units.0, price);
        if debt.saturating_mul(10_000) > value.saturating_mul(SHARE_LTV_BPS) {
            env::panic_str("loan above 50 percent of share value");
        }
        let gross = self.lend(&borrower, amount.0);
        loan.debt = U128(loan.debt.0 + gross);
        self.put_share_loan(&borrower, &asset_id, loan);
        emit(
            "loan_opened",
            json!({ "account_id": borrower, "asset_id": asset_id, "amount": amount.0.to_string(), "fee": fee.to_string() }),
        );
        U128(gross)
    }

    /// Repay a share loan. Clearing the debt returns every locked share.
    pub fn repay_share_loan(&mut self, asset_id: String, amount: U128) -> U128 {
        let borrower = env::predecessor_account_id();
        let mut loan = self.share_loan(&borrower, &asset_id);
        let applied = loan.debt.0.min(amount.0);
        self.take_unallocated(&borrower, applied);
        self.receive_repayment(applied);
        loan.debt = U128(loan.debt.0 - applied);
        if loan.debt.0 == 0 {
            self.shares.add_units(&borrower, &asset_id, loan.units.0);
            loan.units = U128(0);
        }
        self.put_share_loan(&borrower, &asset_id, loan);
        emit(
            "loan_repaid",
            json!({ "account_id": borrower, "asset_id": asset_id, "amount": applied.to_string() }),
        );
        U128(applied)
    }

    /// Sell a loan's shares to the desk once debt passes 65 percent of their value.
    pub fn liquidate_loan(&mut self, account_id: AccountId, asset_id: String) {
        let caller = env::predecessor_account_id();
        let price = self.shares.fresh_price(&asset_id, env::block_timestamp());
        let loan = self.share_loan(&account_id, &asset_id);
        let value = value_of(loan.units.0, price);
        if loan.debt.0 == 0
            || loan.debt.0.saturating_mul(10_000) <= value.saturating_mul(SHARE_LIQUIDATION_BPS)
        {
            env::panic_str("not liquidatable");
        }
        if self.shares.desk_cash < value {
            env::panic_str("desk is short");
        }
        self.shares.desk_cash -= value;
        self.shares.change_supply(&asset_id, 0, loan.units.0);
        let repaid = loan.debt.0.min(value);
        self.settle_liquidated_debt(loan.debt.0, repaid);
        let left = value - repaid;
        let reward = (value * LOAN_LIQUIDATOR_BPS / 10_000).min(left);
        self.credit_unallocated(&caller, reward);
        self.credit_unallocated(&account_id, left - reward);
        self.put_share_loan(&account_id, &asset_id, ShareLoan::default());
        emit(
            "loan_liquidated",
            json!({ "account_id": account_id, "asset_id": asset_id, "repaid": repaid.to_string(), "reward": reward.to_string() }),
        );
    }

    pub fn get_pool(&self) -> PoolView {
        PoolView {
            cash: U128(self.pool.cash),
            lent: U128(self.pool.lent),
            fees: U128(self.pool.fees),
            bad_debt: U128(self.pool.bad_debt),
        }
    }

    pub fn get_share_loan(&self, account_id: AccountId, asset_id: String) -> ShareLoan {
        self.share_loan(&account_id, &asset_id)
    }

    pub fn get_fee_account(&self) -> AccountId {
        self.fee_account.clone()
    }
}
