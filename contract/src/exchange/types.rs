use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::AccountId;

use crate::math::Side;

use super::error::ExchangeError;

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, BorshDeserialize, BorshSerialize, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "snake_case")]
pub enum OrderKind {
    Limit,
    PostOnly,
    ImmediateOrCancel,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Market {
    pub symbol: String,
    pub category: String,
    pub tick_size: u128,
    pub initial_margin_bps: u32,
    pub maintenance_margin_bps: u32,
    pub max_funding_bps: u32,
    pub mark_ticks: u64,
    pub index_ticks: u64,
    pub insurance: u128,
    pub next_order_id: u64,
    pub next_sequence: u64,
    /// Sum of long lots. Short lots are the other side of the same positions.
    pub open_interest_lots: u64,
    /// Quote atoms traded, added on each fill.
    pub volume_quote: u128,
    /// Quote atoms per lot that a long has paid since the market opened.
    pub funding_index: i128,
    pub last_funding_ns: u64,
    pub funding_interval_ns: u64,
    /// Funding or liquidation shortfall the insurance could not cover.
    pub bad_debt: u128,
    pub asset_id: String,
    pub mark_updated_ns: u64,
    pub stale_after_ns: u64,
    /// JSON for `custom_call` when this market is not a built-in oracle asset.
    pub custom_request: Option<String>,
    /// A print outside the 25 percent band, waiting for a second print within 1 percent.
    pub pending_mark_ticks: u64,
    pub pending_index_ticks: u64,
    /// Debt repaid to the lending pool during liquidation, collected by the contract.
    pub pool_repaid: u128,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Trader {
    pub collateral: u128,
    pub base_lots: i64,
    pub entry_quote_per_lot: u128,
    pub open_bid_lots: u64,
    pub open_ask_lots: u64,
    /// Funding index this trader has already been charged through.
    pub last_funding_index: i128,
    /// Quote atoms borrowed against this position. Repaid before the trader.
    pub debt: u128,
}

#[derive(Clone, Debug, PartialEq, Eq, BorshDeserialize, BorshSerialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct Order {
    pub id: u64,
    pub trader: AccountId,
    pub side: Side,
    pub kind: OrderKind,
    pub ticks: u64,
    pub lots: u64,
    pub sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Level {
    pub ticks: u64,
    pub lots: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PlaceResult {
    pub order_id: Option<u64>,
    pub rested_lots: u64,
    pub filled_lots: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TraderState {
    pub collateral: u128,
    pub base_lots: i64,
    pub entry_quote_per_lot: u128,
    pub unrealized_pnl: i128,
    pub equity: i128,
    pub initial_margin: u128,
    pub maintenance_margin: u128,
    pub free_collateral: u128,
    pub liquidation_quote_per_lot: Option<u128>,
    pub open_bid_lots: u64,
    pub open_ask_lots: u64,
    pub debt: u128,
}

pub fn validate_market(
    symbol: &str,
    category: &str,
    tick_size: u128,
    initial_margin_bps: u32,
    maintenance_margin_bps: u32,
    max_funding_bps: u32,
    funding_interval_ns: u64,
) -> Result<(), ExchangeError> {
    if symbol.is_empty() || symbol.len() > 32 {
        return Err(ExchangeError::InvalidMarket("symbol"));
    }
    if category.is_empty() || category.len() > 32 {
        return Err(ExchangeError::InvalidMarket("category"));
    }
    if tick_size == 0 {
        return Err(ExchangeError::InvalidMarket("tick size"));
    }
    if initial_margin_bps == 0 || initial_margin_bps > 10_000 {
        return Err(ExchangeError::InvalidMarket("initial margin"));
    }
    if maintenance_margin_bps == 0 || maintenance_margin_bps >= initial_margin_bps {
        return Err(ExchangeError::InvalidMarket("maintenance margin"));
    }
    if max_funding_bps > 10_000 {
        return Err(ExchangeError::InvalidMarket("funding cap"));
    }
    if funding_interval_ns == 0 {
        return Err(ExchangeError::InvalidMarket("funding interval"));
    }
    Ok(())
}
