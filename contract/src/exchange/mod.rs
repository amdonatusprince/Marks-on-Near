//! One isolated perpetual and its resting book.
//!
//! A limit order fills against resting liquidity, then rests what is left.
//! Post-only never takes. Immediate-or-cancel takes and does not rest.
//! Margin for a new order is checked as if that order filled at its own price,
//! and again at the mark for whatever size actually rests.

mod account;
mod collateral;
mod error;
mod funding;
mod liquidate;
mod mark;
mod r#match;
mod orders;
mod types;

pub use error::ExchangeError;
pub use types::{Level, Market, Order, OrderKind, PlaceResult, Trader};

use std::collections::{BTreeMap, VecDeque};

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::AccountId;

use types::validate_market;

#[derive(Clone, Debug, BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Exchange {
    pub market: Market,
    pub traders: BTreeMap<AccountId, Trader>,
    pub orders: BTreeMap<u64, Order>,
    pub bids: BTreeMap<u64, VecDeque<u64>>,
    pub asks: BTreeMap<u64, VecDeque<u64>>,
    /// Timestamp of the call in progress. Set by the contract before it mutates.
    pub observed_ns: u64,
}

impl Exchange {
    pub fn new(
        symbol: String,
        category: String,
        tick_size: u128,
        initial_margin_bps: u32,
        maintenance_margin_bps: u32,
        max_funding_bps: u32,
        funding_interval_ns: u64,
    ) -> Result<Self, ExchangeError> {
        validate_market(
            &symbol,
            &category,
            tick_size,
            initial_margin_bps,
            maintenance_margin_bps,
            max_funding_bps,
            funding_interval_ns,
        )?;
        Ok(Self {
            market: Market {
                symbol,
                category,
                tick_size,
                initial_margin_bps,
                maintenance_margin_bps,
                max_funding_bps,
                mark_ticks: 0,
                index_ticks: 0,
                insurance: 0,
                next_order_id: 1,
                next_sequence: 1,
                open_interest_lots: 0,
                volume_quote: 0,
                funding_index: 0,
                last_funding_ns: 0,
                funding_interval_ns,
                bad_debt: 0,
                asset_id: String::new(),
                mark_updated_ns: 0,
                stale_after_ns: u64::MAX,
                custom_request: None,
            },
            traders: BTreeMap::new(),
            orders: BTreeMap::new(),
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            observed_ns: 0,
        })
    }

    pub fn note_time(&mut self, now_ns: u64) {
        self.observed_ns = now_ns;
    }
}

#[cfg(test)]
mod tests;
