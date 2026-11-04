//! Marks, a perpetual market on NEAR.
//!
//! Collateral arrives through the NEP-141 `ft_on_transfer` hook into an
//! unallocated balance. `commit` moves that balance into one market.
//! `withdraw` sends unallocated balance back through the token, and
//! `on_withdraw` refunds it if the transfer fails. A mark is written only
//! by the oracle account stored at `new`.
//!
//! v2 adds a lending pool (`loans`), shares at the mark (`shares`), capped
//! calls (`options`) and gifts by link (`gifts`). Every fee goes to the fee
//! account fixed at `new`.

mod balances;
mod exchange;
mod gifts;
mod loans;
mod math;
mod options;
mod oracle;
mod shares;
mod views;

use std::collections::BTreeMap;

use exchange::{Exchange, ExchangeError, PlaceResult};
use math::{funding_rate_bps, Side};
use near_sdk::json_types::{I128, U128};
use near_sdk::{env, ext_contract, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};
use oracle::{ticks_from_decimal, ticks_from_price, CustomDataResult, PriceData};
use views::{BookView, MarketView, OrderView, TraderView};

#[allow(dead_code)]
#[ext_contract(ext_ft)]
trait CollateralToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[allow(dead_code)]
#[ext_contract(ext_self)]
trait WithdrawCallback {
    fn on_withdraw(&mut self, account_id: AccountId, amount: U128);
}

#[allow(dead_code)]
#[ext_contract(ext_oracle)]
trait PriceOracle {
    fn oracle_call(
        &mut self,
        receiver_id: AccountId,
        asset_ids: Option<Vec<String>>,
        msg: String,
        resource_limits: Option<near_sdk::serde_json::Value>,
    );
    fn custom_call(
        &mut self,
        receiver_id: AccountId,
        custom_data_request: Vec<near_sdk::serde_json::Value>,
        msg: String,
        resource_limits: Option<near_sdk::serde_json::Value>,
    );
    fn get_print_after(&self, asset_id: String, ts_ns: u64);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Marks {
    markets: BTreeMap<String, Exchange>,
    collateral_token: AccountId,
    oracle: AccountId,
    unallocated: BTreeMap<AccountId, u128>,
    fee_account: AccountId,
    pool: loans::Pool,
    shares: shares::ShareBook,
    series: BTreeMap<String, options::Series>,
    gifts: gifts::GiftBook,
}

#[near]
impl Marks {
    #[init]
    pub fn new(collateral_token: AccountId, oracle: AccountId, fee_account: AccountId) -> Self {
        Self {
            markets: BTreeMap::new(),
            collateral_token,
            oracle,
            unallocated: BTreeMap::new(),
            fee_account,
            pool: loans::Pool::default(),
            shares: shares::ShareBook::default(),
            series: BTreeMap::new(),
            gifts: gifts::GiftBook::default(),
        }
    }

    /// List a market and lock the insurance bond. The parameters never change.
    pub fn create_market(
        &mut self,
        symbol: String,
        category: String,
        tick_size: U128,
        initial_margin_bps: u32,
        maintenance_margin_bps: u32,
        max_funding_bps: u32,
        funding_interval_ns: u64,
        asset_id: String,
        stale_after_ns: u64,
        insurance: U128,
        custom_request: Option<String>,
    ) {
        if self.markets.contains_key(&symbol) {
            env::panic_str("market already listed");
        }
        let lister = env::predecessor_account_id();
        if insurance.0 > 0 {
            self.take_unallocated(&lister, insurance.0);
        }
        let mut exchange = Exchange::new(
            symbol.clone(),
            category,
            tick_size.0,
            initial_margin_bps,
            maintenance_margin_bps,
            max_funding_bps,
            funding_interval_ns,
        )
        .unwrap_or_else(|error| env::panic_str(&error.to_string()));
        exchange.market.asset_id = asset_id;
        exchange.market.stale_after_ns = stale_after_ns;
        exchange.market.insurance = insurance.0;
        exchange.market.custom_request = custom_request;
        self.markets.insert(symbol, exchange);
    }

    /// NEP-141 deposit hook. Only the configured collateral token can call it.
    /// An empty `msg` credits the sender's unallocated balance; `pool` supplies
    /// the lending pool; `desk` funds the share desk.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        if env::predecessor_account_id() != self.collateral_token {
            env::panic_str("collateral token only");
        }
        if amount.0 == 0 {
            env::panic_str("size is zero");
        }
        self.route_deposit(sender_id, amount.0, &msg);
        U128(0)
    }

    /// Move unallocated balance into this market's margin.
    pub fn commit(&mut self, symbol: String, amount: U128) {
        let trader = env::predecessor_account_id();
        if !self.markets.contains_key(&symbol) {
            must::<()>(Err(ExchangeError::UnknownMarket));
        }
        self.take_unallocated(&trader, amount.0);
        must(self.book_mut(&symbol).credit(&trader, amount.0));
    }

    /// Move free collateral from the market back to the unallocated balance.
    pub fn release(&mut self, symbol: String, amount: U128) {
        let trader = env::predecessor_account_id();
        self.ensure_not_gifted(&symbol, &trader);
        self.book_mut(&symbol).note_time(env::block_timestamp());
        must(self.book_mut(&symbol).settle_funding(&trader).map(|_| ()));
        must(self.book_mut(&symbol).withdraw(&trader, amount.0));
        self.credit_unallocated(&trader, amount.0);
    }

    /// Send unallocated balance to the caller through the collateral token.
    /// A failed transfer is credited back in `on_withdraw`.
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        let trader = env::predecessor_account_id();
        self.take_unallocated(&trader, amount.0);
        ext_ft::ext(self.collateral_token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(30))
            .ft_transfer(trader.clone(), amount, None)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_withdraw(trader, amount),
            )
    }

    pub fn on_withdraw(&mut self, account_id: AccountId, amount: U128) {
        if env::predecessor_account_id() != env::current_account_id() {
            env::panic_str("withdraw callback only");
        }
        if env::promise_result_checked(0, 1024).is_err() {
            self.credit_unallocated(&account_id, amount.0);
        }
    }

    /// Ask the oracle for this market's asset. The caller attaches the oracle fee.
    #[payable]
    pub fn refresh_mark(&mut self, symbol: String) -> Promise {
        let asset_id = self.book(&symbol).market.asset_id.clone();
        let custom_request = self.book(&symbol).market.custom_request.clone();
        let call = ext_oracle::ext(self.oracle.clone())
            .with_attached_deposit(NearToken::from_millinear(20))
            .with_unused_gas_weight(1);
        if let Some(request) = custom_request {
            let requests: Vec<near_sdk::serde_json::Value> =
                near_sdk::serde_json::from_str(&request)
                    .unwrap_or_else(|_| env::panic_str("price missing"));
            call.custom_call(env::current_account_id(), requests, symbol, None)
        } else {
            call.oracle_call(
                env::current_account_id(),
                Some(vec![asset_id]),
                symbol,
                None,
            )
        }
    }

    /// The only price write. The predecessor must be the oracle stored at `new`.
    pub fn oracle_on_call(&mut self, sender_id: AccountId, data: PriceData, msg: String) {
        let _ = sender_id;
        if env::predecessor_account_id() != self.oracle {
            env::panic_str("oracle only");
        }
        if let Some(share) = msg.strip_prefix("share:") {
            let print = data
                .prices
                .iter()
                .find(|price| price.asset_id == share)
                .and_then(|price| price.price.as_ref())
                .and_then(|price| ticks_from_price(&price.multiplier, price.decimals, 1))
                .unwrap_or_else(|| env::panic_str("price missing"));
            let updated = data
                .timestamp
                .parse::<u64>()
                .unwrap_or_else(|_| env::panic_str("price missing"));
            self.write_share_price(share, u128::from(print), updated);
            return;
        }
        let tick_size = self.book(&msg).market.tick_size;
        let asset_id = self.book(&msg).market.asset_id.clone();
        let mark = data
            .prices
            .iter()
            .find(|price| price.asset_id == asset_id)
            .and_then(|price| price.price.as_ref())
            .unwrap_or_else(|| env::panic_str("price missing"));
        let mark_ticks = ticks_from_price(&mark.multiplier, mark.decimals, tick_size)
            .filter(|ticks| *ticks > 0)
            .unwrap_or_else(|| env::panic_str("price missing"));
        let index_id = format!("{asset_id}:index");
        let index_ticks = data
            .prices
            .iter()
            .find(|price| price.asset_id == index_id)
            .and_then(|price| price.price.as_ref())
            .and_then(|price| ticks_from_price(&price.multiplier, price.decimals, tick_size))
            .filter(|ticks| *ticks > 0)
            .unwrap_or(mark_ticks);
        let updated = data
            .timestamp
            .parse::<u64>()
            .unwrap_or_else(|_| env::panic_str("price missing"));
        self.write_mark(&msg, mark_ticks, index_ticks, updated);
    }

    /// Custom fetch callback. An empty or failed payload leaves the mark unchanged.
    pub fn on_custom_data(
        &mut self,
        sender_id: AccountId,
        data: Vec<CustomDataResult>,
        msg: String,
    ) {
        let _ = sender_id;
        if env::predecessor_account_id() != self.oracle {
            env::panic_str("oracle only");
        }
        let tick_size = self.book(&msg).market.tick_size;
        let result = data
            .iter()
            .find(|item| item.error.is_none() && item.value.is_some())
            .unwrap_or_else(|| env::panic_str("price missing"));
        let value = result
            .value
            .as_ref()
            .unwrap_or_else(|| env::panic_str("price missing"));
        let raw = match value {
            near_sdk::serde_json::Value::Number(number) => number.to_string(),
            near_sdk::serde_json::Value::String(text) => text.clone(),
            _ => env::panic_str("price missing"),
        };
        let mark_ticks =
            ticks_from_decimal(&raw, tick_size).unwrap_or_else(|| env::panic_str("price missing"));
        let updated = result.timestamp.unwrap_or_else(env::block_timestamp);
        let updated = if updated > 1_000_000_000_000_000 {
            updated
        } else {
            updated.saturating_mul(1_000_000_000)
        };
        self.write_mark(&msg, mark_ticks, mark_ticks, updated);
    }

    pub fn place_order(
        &mut self,
        symbol: String,
        side: Side,
        kind: exchange::OrderKind,
        ticks: u64,
        lots: u64,
    ) -> PlaceResult {
        let trader = env::predecessor_account_id();
        self.ensure_not_gifted(&symbol, &trader);
        self.book_mut(&symbol).note_time(env::block_timestamp());
        must(
            self.book_mut(&symbol)
                .place(&trader, side, kind, ticks, lots),
        )
    }

    pub fn cancel_order(&mut self, symbol: String, order_id: u64) {
        let trader = env::predecessor_account_id();
        self.book_mut(&symbol).note_time(env::block_timestamp());
        must(self.book_mut(&symbol).cancel(&trader, order_id).map(|_| ()))
    }

    /// Advance funding by up to 24 intervals and charge the caller.
    pub fn settle_funding(&mut self, symbol: String) -> I128 {
        let trader = env::predecessor_account_id();
        self.book_mut(&symbol).note_time(env::block_timestamp());
        I128(must(self.book_mut(&symbol).settle_funding(&trader)))
    }

    /// Close an under-margined position at the mark. Anyone may call it.
    pub fn liquidate(&mut self, symbol: String, account_id: AccountId) {
        let caller = env::predecessor_account_id();
        let book = self.book_mut(&symbol);
        book.note_time(env::block_timestamp());
        let debt_before = book
            .traders
            .get(&account_id)
            .map(|trader| trader.debt)
            .unwrap_or(0);
        must(book.liquidate(&caller, &account_id));
        let repaid = book.collect_pool_repaid();
        if debt_before > 0 {
            self.settle_liquidated_debt(debt_before, repaid);
        }
        self.void_position_gift(&symbol, &account_id);
    }

    pub fn get_funding_rate_bps(&self, symbol: String) -> i64 {
        let market = &self.book(&symbol).market;
        funding_rate_bps(
            market.mark_ticks,
            market.index_ticks,
            market.max_funding_bps,
        )
        .unwrap_or_else(|| env::panic_str("overflow"))
    }

    pub fn get_markets(&self) -> Vec<MarketView> {
        self.markets
            .keys()
            .map(|symbol| self.market_view(symbol))
            .collect()
    }

    pub fn get_market(&self, symbol: String) -> MarketView {
        self.market_view(&symbol)
    }

    pub fn get_trader(&self, symbol: String, account_id: AccountId) -> TraderView {
        let state = must(self.book(&symbol).trader_state(&account_id));
        TraderView {
            collateral: U128(state.collateral),
            base_lots: state.base_lots,
            entry_quote_per_lot: U128(state.entry_quote_per_lot),
            unrealized_pnl: I128(state.unrealized_pnl),
            equity: I128(state.equity),
            initial_margin: U128(state.initial_margin),
            maintenance_margin: U128(state.maintenance_margin),
            free_collateral: U128(state.free_collateral),
            liquidation_quote_per_lot: state.liquidation_quote_per_lot.map(U128),
            open_bid_lots: state.open_bid_lots,
            open_ask_lots: state.open_ask_lots,
            unallocated: U128(self.balance_of(&account_id)),
            debt: U128(state.debt),
            borrow_limit: U128(
                self.book(&symbol)
                    .borrow_limit(&account_id)
                    .unwrap_or(0)
                    .saturating_mul(10_000)
                    / 10_100,
            ),
            gift_id: self.frozen_gift(&symbol, &account_id),
        }
    }

    pub fn get_l2(&self, symbol: String, depth: u32) -> BookView {
        let (bids, asks) = self.book(&symbol).l2(depth as usize);
        BookView { bids, asks }
    }

    pub fn get_order(&self, symbol: String, order_id: u64) -> Option<OrderView> {
        self.book(&symbol).order(order_id).map(|order| OrderView {
            id: order.id,
            trader: order.trader.clone(),
            side: order.side,
            kind: order.kind,
            ticks: order.ticks,
            lots: order.lots,
            sequence: order.sequence,
        })
    }
}

impl Marks {
    pub(crate) fn book(&self, symbol: &str) -> &Exchange {
        self.markets
            .get(symbol)
            .unwrap_or_else(|| env::panic_str("unknown market"))
    }

    pub(crate) fn book_mut(&mut self, symbol: &str) -> &mut Exchange {
        self.markets
            .get_mut(symbol)
            .unwrap_or_else(|| env::panic_str("unknown market"))
    }

    fn write_mark(&mut self, symbol: &str, mark_ticks: u64, index_ticks: u64, updated_ns: u64) {
        match self.book_mut(symbol).push_mark(mark_ticks, index_ticks) {
            Ok(()) => self.book_mut(symbol).market.mark_updated_ns = updated_ns,
            Err(ExchangeError::MarkDeviation) => balances::emit(
                "mark_pending",
                near_sdk::serde_json::json!({ "symbol": symbol, "mark_ticks": mark_ticks }),
            ),
            Err(error) => env::panic_str(&error.to_string()),
        }
    }

    fn market_view(&self, symbol: &str) -> MarketView {
        let market = &self.book(symbol).market;
        MarketView {
            symbol: market.symbol.clone(),
            category: market.category.clone(),
            tick_size: U128(market.tick_size),
            initial_margin_bps: market.initial_margin_bps,
            maintenance_margin_bps: market.maintenance_margin_bps,
            max_funding_bps: market.max_funding_bps,
            mark_ticks: market.mark_ticks,
            index_ticks: market.index_ticks,
            insurance: U128(market.insurance),
            open_interest_lots: market.open_interest_lots,
            volume_quote: U128(market.volume_quote),
            funding_index: I128(market.funding_index),
            funding_interval_ns: U128(u128::from(market.funding_interval_ns)),
            bad_debt: U128(market.bad_debt),
            asset_id: market.asset_id.clone(),
            mark_updated_ns: U128(u128::from(market.mark_updated_ns)),
        }
    }
}

pub(crate) fn must<T>(result: Result<T, ExchangeError>) -> T {
    result.unwrap_or_else(|error| env::panic_str(&error.to_string()))
}

#[cfg(test)]
mod api_tests;
#[cfg(test)]
mod v2_tests;
