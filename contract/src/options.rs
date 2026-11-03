//! Capped calls on a listed share, fully paid on both sides.
//!
//! One contract pays `min(max(S − K, 0), C − K)` at expiry, where `S` is the
//! first oracle print at or after expiry. The buyer escrows the premium and
//! can lose nothing more. The seller escrows `C − K` and keeps whatever the
//! buyer does not earn. No margin and no liquidation.

use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, Gas, PromiseError};

use crate::balances::emit;
use crate::math::Side;
use crate::oracle::ticks_from_price;
use crate::{ext_oracle, Marks, MarksExt};

const MAX_FILLS: usize = 16;
const MAX_RESTING: usize = 200;
const MAX_LOTS: u64 = 100_000;
const MIN_LIFE_NS: u64 = 60 * 60 * 1_000_000_000;
const MAX_LIFE_NS: u64 = 366 * 24 * 60 * 60 * 1_000_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OptionOrder {
    pub id: u64,
    pub trader: AccountId,
    pub side: Side,
    /// Quote atoms per contract.
    pub premium: U128,
    pub lots: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OptionPosition {
    pub long: u64,
    pub short: u64,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Series {
    pub id: String,
    pub asset_id: String,
    pub strike: u128,
    pub cap: u128,
    pub expiry_ns: u64,
    pub settle_price: Option<u128>,
    pub next_order_id: u64,
    pub orders: BTreeMap<u64, OptionOrder>,
    pub positions: BTreeMap<AccountId, OptionPosition>,
    pub open_interest: u64,
    pub volume: u128,
    pub last_premium: u128,
}

#[near(serializers = [json])]
pub struct SeriesView {
    pub id: String,
    pub asset_id: String,
    pub strike: U128,
    pub cap: U128,
    pub expiry_ns: U128,
    pub settle_price: Option<U128>,
    pub open_interest: u64,
    pub volume: U128,
    pub last_premium: U128,
    pub best_bid: Option<U128>,
    pub best_ask: Option<U128>,
}

#[near(serializers = [json])]
pub struct OptionLevel {
    pub premium: U128,
    pub lots: u64,
}

#[near(serializers = [json])]
pub struct OptionBookView {
    pub bids: Vec<OptionLevel>,
    pub asks: Vec<OptionLevel>,
}

#[near(serializers = [json])]
pub struct OptionPlaceResult {
    pub order_id: Option<u64>,
    pub filled_lots: u64,
    pub rested_lots: u64,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct OraclePrint {
    pub timestamp_ms: u64,
    pub multiplier: String,
    pub decimals: u32,
}

impl Series {
    pub fn width(&self) -> u128 {
        self.cap - self.strike
    }

    /// Payout per contract once settled.
    pub fn payout(&self, settle: u128) -> u128 {
        settle.saturating_sub(self.strike).min(self.width())
    }

    fn escrow(&self, side: Side, premium: u128, lots: u64) -> u128 {
        let per = match side {
            Side::Bid => premium,
            Side::Ask => self.width(),
        };
        per.checked_mul(u128::from(lots))
            .unwrap_or_else(|| env::panic_str("overflow"))
    }

    /// Resting orders that cross `premium`, best price first, then oldest.
    fn crossing(&self, side: Side, premium: u128) -> Vec<u64> {
        let mut makers: Vec<&OptionOrder> = self
            .orders
            .values()
            .filter(|order| order.side != side)
            .filter(|order| match side {
                Side::Bid => order.premium.0 <= premium,
                Side::Ask => order.premium.0 >= premium,
            })
            .collect();
        makers.sort_by(|a, b| {
            let price = match side {
                Side::Bid => a.premium.0.cmp(&b.premium.0),
                Side::Ask => b.premium.0.cmp(&a.premium.0),
            };
            price.then(a.id.cmp(&b.id))
        });
        makers.iter().map(|order| order.id).collect()
    }

    fn best(&self, side: Side) -> Option<u128> {
        let prices = self
            .orders
            .values()
            .filter(|order| order.side == side)
            .map(|order| order.premium.0);
        match side {
            Side::Bid => prices.max(),
            Side::Ask => prices.min(),
        }
    }

    fn add_position(&mut self, account: &AccountId, long: u64, short: u64) {
        let position = self.positions.entry(account.clone()).or_default();
        position.long += long;
        position.short += short;
        self.open_interest += long;
    }

    fn view(&self) -> SeriesView {
        SeriesView {
            id: self.id.clone(),
            asset_id: self.asset_id.clone(),
            strike: U128(self.strike),
            cap: U128(self.cap),
            expiry_ns: U128(u128::from(self.expiry_ns)),
            settle_price: self.settle_price.map(U128),
            open_interest: self.open_interest,
            volume: U128(self.volume),
            last_premium: U128(self.last_premium),
            best_bid: self.best(Side::Bid).map(U128),
            best_ask: self.best(Side::Ask).map(U128),
        }
    }
}

impl Marks {
    fn series(&self, id: &str) -> &Series {
        self.series
            .get(id)
            .unwrap_or_else(|| env::panic_str("unknown series"))
    }

    fn series_mut(&mut self, id: &str) -> &mut Series {
        self.series
            .get_mut(id)
            .unwrap_or_else(|| env::panic_str("unknown series"))
    }
}

#[near]
impl Marks {
    /// List a capped call. Strike and cap are quote atoms per share.
    pub fn list_series(
        &mut self,
        asset_id: String,
        strike: U128,
        cap: U128,
        expiry_ns: u64,
    ) -> String {
        self.shares.asset(&asset_id);
        let now = env::block_timestamp();
        if strike.0 == 0 || cap.0 <= strike.0 {
            env::panic_str("cap must be above strike");
        }
        if expiry_ns < now.saturating_add(MIN_LIFE_NS)
            || expiry_ns > now.saturating_add(MAX_LIFE_NS)
        {
            env::panic_str("expiry out of range");
        }
        let id = format!(
            "{}-{}-{}-{}",
            asset_id.to_uppercase(),
            strike.0 / 1_000_000,
            cap.0 / 1_000_000,
            expiry_ns / 1_000_000_000
        );
        if self.series.contains_key(&id) {
            env::panic_str("series already listed");
        }
        self.series.insert(
            id.clone(),
            Series {
                id: id.clone(),
                asset_id: asset_id.clone(),
                strike: strike.0,
                cap: cap.0,
                expiry_ns,
                settle_price: None,
                next_order_id: 1,
                orders: BTreeMap::new(),
                positions: BTreeMap::new(),
                open_interest: 0,
                volume: 0,
                last_premium: 0,
            },
        );
        emit(
            "series_listed",
            json!({ "series_id": id, "asset_id": asset_id, "strike": strike.0.to_string(), "cap": cap.0.to_string(), "expiry_ns": expiry_ns.to_string() }),
        );
        id
    }

    /// Buy (bid) or sell (ask) contracts at a premium. Escrow comes from the unallocated balance.
    pub fn place_option(
        &mut self,
        series_id: String,
        side: Side,
        premium: U128,
        lots: u64,
    ) -> OptionPlaceResult {
        let trader = env::predecessor_account_id();
        let now = env::block_timestamp();
        let series = self.series(&series_id);
        if now >= series.expiry_ns {
            env::panic_str("series expired");
        }
        if lots == 0 || lots > MAX_LOTS {
            env::panic_str("size is zero");
        }
        if premium.0 == 0 || premium.0 > series.width() {
            env::panic_str("premium out of range");
        }
        let makers = series.crossing(side, premium.0);
        let mut plan: Vec<(u64, u64, u128, AccountId)> = Vec::new();
        let mut remaining = lots;
        for id in makers {
            if remaining == 0 {
                break;
            }
            if plan.len() == MAX_FILLS {
                env::panic_str("book too dense");
            }
            let order = &series.orders[&id];
            if order.trader == trader {
                env::panic_str("self-trade");
            }
            let take = remaining.min(order.lots);
            plan.push((id, take, order.premium.0, order.trader.clone()));
            remaining -= take;
        }
        if remaining > 0 && series.orders.len() >= MAX_RESTING {
            env::panic_str("book too dense");
        }
        let escrow = series.escrow(side, premium.0, lots);
        self.take_unallocated(&trader, escrow);

        let mut filled = 0u64;
        for (id, take, price, maker) in plan {
            let traded = price * u128::from(take);
            match side {
                Side::Bid => {
                    // Taker buys at the maker's lower premium; the difference returns.
                    self.credit_unallocated(&trader, (premium.0 - price) * u128::from(take));
                    self.credit_unallocated(&maker, traded);
                    let series = self.series_mut(&series_id);
                    series.add_position(&trader, take, 0);
                    series.add_position(&maker, 0, take);
                }
                Side::Ask => {
                    self.credit_unallocated(&trader, traded);
                    let series = self.series_mut(&series_id);
                    series.add_position(&maker, take, 0);
                    series.add_position(&trader, 0, take);
                }
            }
            let series = self.series_mut(&series_id);
            let order = series.orders.get_mut(&id).unwrap();
            order.lots -= take;
            if order.lots == 0 {
                series.orders.remove(&id);
            }
            series.volume += traded;
            series.last_premium = price;
            filled += take;
            emit(
                "option_fill",
                json!({ "series_id": series_id, "maker": maker, "taker": trader, "premium": price.to_string(), "lots": take }),
            );
        }
        let series = self.series_mut(&series_id);
        let order_id = if remaining > 0 {
            let id = series.next_order_id;
            series.next_order_id += 1;
            series.orders.insert(
                id,
                OptionOrder {
                    id,
                    trader: trader.clone(),
                    side,
                    premium,
                    lots: remaining,
                },
            );
            Some(id)
        } else {
            None
        };
        OptionPlaceResult {
            order_id,
            filled_lots: filled,
            rested_lots: remaining,
        }
    }

    /// Cancel a resting option order and return its escrow.
    pub fn cancel_option(&mut self, series_id: String, order_id: u64) {
        let trader = env::predecessor_account_id();
        let series = self.series_mut(&series_id);
        let order = series
            .orders
            .get(&order_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown order"));
        if order.trader != trader {
            env::panic_str("not the order owner");
        }
        series.orders.remove(&order_id);
        let refund = series.escrow(order.side, order.premium.0, order.lots);
        self.credit_unallocated(&trader, refund);
    }

    /// Read the first oracle print at or after expiry and fix the settlement price.
    pub fn settle_series(&mut self, series_id: String) -> near_sdk::Promise {
        let series = self.series(&series_id);
        if env::block_timestamp() < series.expiry_ns {
            env::panic_str("series not expired");
        }
        if series.settle_price.is_some() {
            env::panic_str("series already settled");
        }
        ext_oracle::ext(self.oracle.clone())
            .with_static_gas(Gas::from_tgas(10))
            .get_print_after(series.asset_id.clone(), series.expiry_ns)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_series_print(series_id),
            )
    }

    #[private]
    pub fn on_series_print(
        &mut self,
        series_id: String,
        #[callback_result] print: Result<Option<OraclePrint>, PromiseError>,
    ) -> U128 {
        let print = print
            .ok()
            .flatten()
            .unwrap_or_else(|| env::panic_str("no print after expiry yet"));
        let price = ticks_from_price(&print.multiplier, print.decimals, 1)
            .map(u128::from)
            .filter(|price| *price > 0)
            .unwrap_or_else(|| env::panic_str("price missing"));
        self.write_settlement(&series_id, price);
        U128(price)
    }

    /// Pay a settled position: longs earn the payout, shorts keep the rest of their escrow.
    pub fn claim_settlement(&mut self, series_id: String) -> U128 {
        let account = env::predecessor_account_id();
        let series = self.series_mut(&series_id);
        let settle = series
            .settle_price
            .unwrap_or_else(|| env::panic_str("series not settled"));
        let position = series
            .positions
            .remove(&account)
            .unwrap_or_else(|| env::panic_str("no position"));
        let payout = series.payout(settle);
        let width = series.width();
        let owed =
            payout * u128::from(position.long) + (width - payout) * u128::from(position.short);
        self.credit_unallocated(&account, owed);
        emit(
            "option_claimed",
            json!({ "series_id": series_id, "account_id": account, "amount": owed.to_string() }),
        );
        U128(owed)
    }

    pub fn get_series_list(&self) -> Vec<SeriesView> {
        self.series.values().map(Series::view).collect()
    }

    pub fn get_series(&self, series_id: String) -> SeriesView {
        self.series(&series_id).view()
    }

    pub fn get_option_book(&self, series_id: String, depth: u32) -> OptionBookView {
        let series = self.series(&series_id);
        let mut bids: BTreeMap<u128, u64> = BTreeMap::new();
        let mut asks: BTreeMap<u128, u64> = BTreeMap::new();
        for order in series.orders.values() {
            let book = match order.side {
                Side::Bid => &mut bids,
                Side::Ask => &mut asks,
            };
            *book.entry(order.premium.0).or_default() += order.lots;
        }
        let level = |(premium, lots): (&u128, &u64)| OptionLevel {
            premium: U128(*premium),
            lots: *lots,
        };
        OptionBookView {
            bids: bids.iter().rev().take(depth as usize).map(level).collect(),
            asks: asks.iter().take(depth as usize).map(level).collect(),
        }
    }

    pub fn get_option_position(&self, series_id: String, account_id: AccountId) -> OptionPosition {
        self.series(&series_id)
            .positions
            .get(&account_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn get_option_orders(&self, series_id: String, account_id: AccountId) -> Vec<OptionOrder> {
        self.series(&series_id)
            .orders
            .values()
            .filter(|order| order.trader == account_id)
            .cloned()
            .collect()
    }
}

impl Marks {
    pub(crate) fn write_settlement(&mut self, series_id: &str, price: u128) {
        let series = self.series_mut(series_id);
        if series.settle_price.is_some() {
            env::panic_str("series already settled");
        }
        series.settle_price = Some(price);
        emit(
            "series_settled",
            json!({ "series_id": series_id, "price": price.to_string() }),
        );
    }
}
