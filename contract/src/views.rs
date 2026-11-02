use near_sdk::json_types::{I128, U128};
use near_sdk::{near, AccountId};

use crate::exchange::{Level, OrderKind};
use crate::math::Side;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MarketView {
    pub symbol: String,
    pub category: String,
    pub tick_size: U128,
    pub initial_margin_bps: u32,
    pub maintenance_margin_bps: u32,
    pub max_funding_bps: u32,
    pub mark_ticks: u64,
    pub index_ticks: u64,
    pub insurance: U128,
    pub open_interest_lots: u64,
    pub volume_quote: U128,
    pub funding_index: I128,
    pub funding_interval_ns: U128,
    pub bad_debt: U128,
    pub asset_id: String,
    pub mark_updated_ns: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TraderView {
    pub collateral: U128,
    pub base_lots: i64,
    pub entry_quote_per_lot: U128,
    pub unrealized_pnl: I128,
    pub equity: I128,
    pub initial_margin: U128,
    pub maintenance_margin: U128,
    pub free_collateral: U128,
    pub liquidation_quote_per_lot: Option<U128>,
    pub open_bid_lots: u64,
    pub open_ask_lots: u64,
    pub unallocated: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BookView {
    pub bids: Vec<Level>,
    pub asks: Vec<Level>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OrderView {
    pub id: u64,
    pub trader: AccountId,
    pub side: Side,
    pub kind: OrderKind,
    pub ticks: u64,
    pub lots: u64,
    pub sequence: u64,
}
