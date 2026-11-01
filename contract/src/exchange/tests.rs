use near_sdk::AccountId;

use crate::math::Side;

use super::{Exchange, ExchangeError, Level, OrderKind};

fn alice() -> AccountId {
    "alice.testnet".parse().unwrap()
}

fn bob() -> AccountId {
    "bob.testnet".parse().unwrap()
}

fn carol() -> AccountId {
    "carol.testnet".parse().unwrap()
}

fn dave() -> AccountId {
    "dave.testnet".parse().unwrap()
}

fn exchange() -> Exchange {
    let mut exchange = Exchange::new(
        "NEAR-PERP".into(),
        "crypto".into(),
        1_000_000,
        1_000,
        500,
        50,
        3_600_000_000_000,
    )
    .unwrap();
    exchange.push_mark(5, 5).unwrap();
    exchange
}

#[test]
fn new_rejects_a_blank_symbol_and_a_maintenance_ratio_above_initial() {
    assert_eq!(
        Exchange::new("".into(), "crypto".into(), 1, 1_000, 500, 50, 1).unwrap_err(),
        ExchangeError::InvalidMarket("symbol")
    );
    assert_eq!(
        Exchange::new("NEAR-PERP".into(), "crypto".into(), 1, 500, 500, 50, 1).unwrap_err(),
        ExchangeError::InvalidMarket("maintenance margin")
    );
    assert_eq!(
        Exchange::new("NEAR-PERP".into(), "crypto".into(), 1, 1_000, 500, 50, 0).unwrap_err(),
        ExchangeError::InvalidMarket("funding interval")
    );
}

#[test]
fn resting_orders_queue_price_then_time_and_only_the_owner_cancels() {
    let mut exchange = exchange();
    exchange.credit(&alice(), 20_000_000).unwrap();
    exchange.credit(&bob(), 20_000_000).unwrap();

    let first = exchange
        .place(&alice(), Side::Bid, OrderKind::Limit, 4, 1)
        .unwrap();
    let second = exchange
        .place(&bob(), Side::Bid, OrderKind::PostOnly, 4, 2)
        .unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, 6, 1)
        .unwrap();

    let (bids, asks) = exchange.l2(10);
    assert_eq!(bids, vec![Level { ticks: 4, lots: 3 }]);
    assert_eq!(asks, vec![Level { ticks: 6, lots: 1 }]);
    assert_eq!(
        exchange
            .bids
            .get(&4)
            .unwrap()
            .iter()
            .copied()
            .collect::<Vec<_>>(),
        vec![first.order_id.unwrap(), second.order_id.unwrap()]
    );

    assert_eq!(
        exchange.cancel(&bob(), first.order_id.unwrap()),
        Err(ExchangeError::NotOrderOwner)
    );
    exchange.cancel(&alice(), first.order_id.unwrap()).unwrap();
    let (bids, _) = exchange.l2(10);
    assert_eq!(bids, vec![Level { ticks: 4, lots: 2 }]);
    assert_eq!(exchange.trader_state(&alice()).unwrap().open_bid_lots, 0);
}

#[test]
fn post_only_rejects_a_cross_and_an_ioc_miss_rests_nothing() {
    let mut exchange = exchange();
    exchange.credit(&alice(), 50_000_000).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, 6, 1)
        .unwrap();

    assert_eq!(
        exchange.place(&alice(), Side::Bid, OrderKind::PostOnly, 6, 1),
        Err(ExchangeError::PostOnlyWouldCross)
    );
    let missed = exchange
        .place(&bob(), Side::Bid, OrderKind::ImmediateOrCancel, 5, 1)
        .unwrap();
    assert_eq!(missed.rested_lots, 0);
    assert_eq!(missed.filled_lots, 0);
    assert!(missed.order_id.is_none());
    assert!(exchange.bids.is_empty());
    assert_eq!(exchange.orders.len(), 1);
}

#[test]
fn margin_uses_mark_notional() {
    let mut exchange = exchange();
    let err = exchange
        .place(&alice(), Side::Bid, OrderKind::Limit, 4, 10)
        .unwrap_err();
    assert_eq!(err, ExchangeError::InsufficientMargin);

    exchange.credit(&alice(), 5_000_000).unwrap();
    exchange
        .place(&alice(), Side::Bid, OrderKind::Limit, 4, 10)
        .unwrap();
    let state = exchange.trader_state(&alice()).unwrap();
    assert_eq!(state.initial_margin, 5_000_000);
    assert_eq!(state.free_collateral, 0);
}

#[test]
fn withdraw_leaves_initial_margin_in_the_account() {
    let mut exchange = exchange();
    exchange.credit(&alice(), 10_000_000).unwrap();
    exchange
        .place(&alice(), Side::Bid, OrderKind::Limit, 4, 10)
        .unwrap();
    assert_eq!(
        exchange.withdraw(&alice(), 6_000_000),
        Err(ExchangeError::InsufficientMargin)
    );
    exchange.withdraw(&alice(), 5_000_000).unwrap();
    assert_eq!(
        exchange.trader_state(&alice()).unwrap().collateral,
        5_000_000
    );
}

#[test]
fn mark_cannot_jump_more_than_a_quarter() {
    let mut exchange = exchange();
    assert_eq!(exchange.push_mark(7, 5), Err(ExchangeError::MarkDeviation));
    exchange.push_mark(6, 5).unwrap();
    assert_eq!(exchange.market.mark_ticks, 6);
}

#[test]
fn a_crossing_limit_fills_both_traders_at_the_resting_price() {
    let tick_size = 1_000_000u128;
    let ask_ticks = 6u64;
    let lots = 1u64;
    let mark_ticks = 5u64;
    let entry = ask_ticks as u128 * tick_size;
    let mark_quote = mark_ticks as u128 * tick_size;
    let unrealized = (mark_quote as i128) - (entry as i128);
    let initial_margin = mark_quote / 10;
    let bob_collateral = (initial_margin as i128 - unrealized) as u128;

    let mut exchange = exchange();
    exchange.credit(&alice(), initial_margin).unwrap();
    exchange.credit(&bob(), bob_collateral).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, ask_ticks, lots)
        .unwrap();

    let filled = exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, ask_ticks, lots)
        .unwrap();
    assert_eq!(filled.filled_lots, lots);
    assert_eq!(filled.rested_lots, 0);
    assert!(filled.order_id.is_none());

    let buyer = exchange.trader_state(&bob()).unwrap();
    assert_eq!(buyer.base_lots, lots as i64);
    assert_eq!(buyer.entry_quote_per_lot, entry);
    assert_eq!(buyer.unrealized_pnl, unrealized);
    let seller = exchange.trader_state(&alice()).unwrap();
    assert_eq!(seller.base_lots, -(lots as i64));
    assert_eq!(seller.entry_quote_per_lot, entry);
    assert_eq!(exchange.market.open_interest_lots, lots);
    assert_eq!(exchange.market.volume_quote, entry);
    assert!(exchange.orders.is_empty());
}

#[test]
fn credit_rejects_zero_and_withdraw_rejects_more_than_the_balance() {
    let mut exchange = exchange();
    assert_eq!(exchange.credit(&alice(), 0), Err(ExchangeError::ZeroSize));
    exchange.credit(&alice(), 5).unwrap();
    assert_eq!(
        exchange.withdraw(&alice(), 6),
        Err(ExchangeError::InsufficientCollateral)
    );
}

#[test]
fn a_partial_fill_rests_the_unfilled_size() {
    let tick_size = 1_000_000u128;
    let ask_ticks = 6u64;
    let offered = 4u64;
    let wanted = 5u64;
    let resting = wanted - offered;
    let mark_quote = 5 * tick_size;
    let entry = ask_ticks as u128 * tick_size;
    let maker_margin = offered as u128 * mark_quote / 10;
    let taker_collateral = {
        let projected_lots = wanted as i128;
        let unrealized = projected_lots * ((mark_quote as i128) - (entry as i128));
        let initial = wanted as u128 * mark_quote / 10;
        (initial as i128 - unrealized) as u128
    };

    let mut exchange = exchange();
    exchange.credit(&alice(), maker_margin).unwrap();
    exchange.credit(&bob(), taker_collateral).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, ask_ticks, offered)
        .unwrap();
    let placed = exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, ask_ticks, wanted)
        .unwrap();

    assert_eq!(placed.filled_lots, offered);
    assert_eq!(placed.rested_lots, resting);
    assert!(exchange.asks.is_empty());
    assert_eq!(exchange.l2(5).0[0].lots, resting);
    assert_eq!(
        exchange.trader_state(&bob()).unwrap().base_lots,
        offered as i64
    );
    assert_eq!(
        exchange.trader_state(&alice()).unwrap().base_lots,
        -(offered as i64)
    );
    assert_eq!(exchange.market.open_interest_lots, offered);
}

#[test]
fn two_makers_at_one_price_fill_oldest_first() {
    let ticks = 6u64;
    let mark_quote = 5_000_000u128;
    let mut exchange = exchange();
    exchange.credit(&alice(), mark_quote / 10).unwrap();
    exchange.credit(&carol(), 2 * mark_quote / 10).unwrap();
    exchange.credit(&bob(), 3_000_000).unwrap();
    let first = exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, ticks, 1)
        .unwrap();
    let second = exchange
        .place(&carol(), Side::Ask, OrderKind::Limit, ticks, 2)
        .unwrap();

    let taken = exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, ticks, 2)
        .unwrap();
    assert_eq!(taken.filled_lots, 2);
    assert!(exchange.order(first.order_id.unwrap()).is_none());
    assert_eq!(exchange.order(second.order_id.unwrap()).unwrap().lots, 1);
    assert_eq!(exchange.trader_state(&alice()).unwrap().base_lots, -1);
    assert_eq!(exchange.trader_state(&carol()).unwrap().base_lots, -1);
    assert_eq!(exchange.trader_state(&bob()).unwrap().base_lots, 2);
}

#[test]
fn immediate_or_cancel_fills_and_does_not_rest() {
    let mut exchange = exchange();
    exchange.credit(&alice(), 500_000).unwrap();
    exchange.credit(&bob(), 1_500_000).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, 6, 1)
        .unwrap();
    let taken = exchange
        .place(&bob(), Side::Bid, OrderKind::ImmediateOrCancel, 6, 2)
        .unwrap();
    assert_eq!(taken.filled_lots, 1);
    assert_eq!(taken.rested_lots, 0);
    assert!(taken.order_id.is_none());
    assert!(exchange.orders.is_empty());
    assert_eq!(exchange.trader_state(&bob()).unwrap().base_lots, 1);
}

#[test]
fn self_trade_writes_nothing() {
    let mut exchange = exchange();
    exchange.credit(&alice(), 5_000_000).unwrap();
    let resting = exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, 6, 1)
        .unwrap();
    let before = exchange.trader_state(&alice()).unwrap();
    assert_eq!(
        exchange.place(&alice(), Side::Bid, OrderKind::Limit, 6, 1),
        Err(ExchangeError::SelfTrade)
    );
    let after = exchange.trader_state(&alice()).unwrap();
    assert_eq!(after, before);
    assert_eq!(exchange.order(resting.order_id.unwrap()).unwrap().lots, 1);
}

#[test]
fn a_seventeenth_fill_writes_nothing() {
    let orders = 17u64;
    let lots = 1u64;
    let ticks = 5u64;
    let mut exchange = exchange();
    let maker_collateral = orders as u128 * 5_000_000 / 10;
    exchange.credit(&alice(), maker_collateral).unwrap();
    exchange.credit(&bob(), maker_collateral).unwrap();
    for _ in 0..orders {
        exchange
            .place(&alice(), Side::Ask, OrderKind::Limit, ticks, lots)
            .unwrap();
    }
    let book_before = exchange.l2(20);
    assert_eq!(
        exchange.place(&bob(), Side::Bid, OrderKind::Limit, ticks, orders),
        Err(ExchangeError::BookTooDense)
    );
    assert_eq!(exchange.l2(20), book_before);
    assert_eq!(exchange.trader_state(&bob()).unwrap().base_lots, 0);
    assert_eq!(exchange.orders.len(), orders as usize);
}

#[test]
fn taker_without_the_immediate_loss_does_not_fill() {
    let lots = 1u64;
    let ask_ticks = 6u64;
    let tick_size = 1_000_000u128;
    let loss = (ask_ticks as u128 - 5) * tick_size;
    let initial_margin = 5 * tick_size / 10;
    let required = initial_margin + loss;
    let mut book = exchange();
    book.credit(&alice(), initial_margin).unwrap();
    book.place(&alice(), Side::Ask, OrderKind::Limit, ask_ticks, lots)
        .unwrap();
    book.credit(&bob(), required - 1).unwrap();
    assert_eq!(
        book.place(&bob(), Side::Bid, OrderKind::Limit, ask_ticks, lots),
        Err(ExchangeError::InsufficientMargin)
    );
    assert_eq!(book.orders.len(), 1);
    assert_eq!(book.trader_state(&bob()).unwrap().base_lots, 0);
    assert_eq!(book.trader_state(&bob()).unwrap().collateral, required - 1);

    let far_ticks = 100u64;
    let far_loss = (far_ticks - 5) as u128 * tick_size;
    let far_margin = 5 * tick_size / 10;
    let mut empty = exchange();
    empty.credit(&carol(), far_loss + far_margin - 1).unwrap();
    assert_eq!(
        empty.place(&carol(), Side::Bid, OrderKind::Limit, far_ticks, lots),
        Err(ExchangeError::InsufficientMargin)
    );
    assert!(empty.orders.is_empty());
}

#[test]
fn two_fills_keep_a_weighted_entry_and_a_flip_realizes() {
    let tick_size = 1_000_000u128;
    let mut exchange = exchange();
    exchange.credit(&alice(), 1_500_000).unwrap();
    exchange.credit(&carol(), 500_000).unwrap();
    exchange.credit(&bob(), 5_000_000).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, 4, 1)
        .unwrap();
    exchange
        .place(&carol(), Side::Ask, OrderKind::Limit, 6, 1)
        .unwrap();

    exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, 6, 2)
        .unwrap();
    let long = exchange.trader_state(&bob()).unwrap();
    let entry = (4 * tick_size + 6 * tick_size) / 2;
    assert_eq!(long.base_lots, 2);
    assert_eq!(long.entry_quote_per_lot, entry);

    let sell_lots = 3u64;
    let sell_ticks = 6u64;
    let close = long.base_lots.unsigned_abs();
    let realized = (sell_ticks as u128 * tick_size - entry) as i128 * close as i128;
    exchange.credit(&dave(), 4_500_000).unwrap();
    exchange
        .place(&dave(), Side::Bid, OrderKind::Limit, sell_ticks, sell_lots)
        .unwrap();
    let collateral_before = exchange.trader_state(&bob()).unwrap().collateral;
    exchange
        .place(&bob(), Side::Ask, OrderKind::Limit, sell_ticks, sell_lots)
        .unwrap();
    let flipped = exchange.trader_state(&bob()).unwrap();
    assert_eq!(flipped.base_lots, long.base_lots - sell_lots as i64);
    assert_eq!(flipped.entry_quote_per_lot, sell_ticks as u128 * tick_size);
    assert_eq!(
        flipped.collateral,
        (collateral_before as i128 + realized) as u128
    );
}

#[test]
fn settled_funding_moves_the_same_amount_between_a_long_and_a_short() {
    let interval = 1_000_000_000u64;
    let lots = 10u64;
    let tick_size = 1_000_000u128;
    let index_ticks = 5u64;
    let mut exchange = Exchange::new(
        "NEAR-PERP".into(),
        "crypto".into(),
        tick_size,
        1_000,
        500,
        50,
        interval,
    )
    .unwrap();
    exchange.push_mark(index_ticks, index_ticks).unwrap();
    let opened_at = 1_000_000_000_000u64;
    exchange.note_time(opened_at);
    let margin = lots as u128 * index_ticks as u128 * tick_size / 10;
    exchange.credit(&alice(), margin * 4).unwrap();
    exchange.credit(&bob(), margin * 4).unwrap();
    exchange.credit(&carol(), 1_000).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, index_ticks, lots)
        .unwrap();
    exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, index_ticks, lots)
        .unwrap();
    exchange.push_mark(6, index_ticks).unwrap();

    let rate = crate::math::funding_rate_bps(6, index_ticks, 50).unwrap();
    let one_interval =
        crate::math::funding_payment(lots as i64, index_ticks, tick_size, rate).unwrap();
    assert_eq!(rate, 50);
    assert_eq!(one_interval, 250_000);

    exchange.note_time(opened_at + interval);
    let long_before = exchange.trader_state(&bob()).unwrap().collateral;
    let short_before = exchange.trader_state(&alice()).unwrap().collateral;
    let flat_before = exchange.trader_state(&carol()).unwrap().collateral;
    assert_eq!(exchange.settle_funding(&bob()).unwrap(), one_interval);
    assert_eq!(exchange.settle_funding(&alice()).unwrap(), -one_interval);
    assert_eq!(exchange.settle_funding(&carol()).unwrap(), 0);
    assert_eq!(
        exchange.trader_state(&bob()).unwrap().collateral,
        (long_before as i128 - one_interval) as u128
    );
    assert_eq!(
        exchange.trader_state(&alice()).unwrap().collateral,
        short_before + one_interval as u128
    );
    assert_eq!(
        exchange.trader_state(&carol()).unwrap().collateral,
        flat_before
    );

    let settled_at = opened_at + interval;
    let quiet_for = 25u64;
    exchange.note_time(settled_at + quiet_for * interval);
    exchange.settle_funding(&carol()).unwrap();
    assert_eq!(exchange.market.last_funding_ns, settled_at + 24 * interval);
    exchange.settle_funding(&carol()).unwrap();
    assert_eq!(
        exchange.market.last_funding_ns,
        settled_at + quiet_for * interval
    );
    let long_after_one = exchange.trader_state(&bob()).unwrap().collateral;
    let catch_up = one_interval * quiet_for as i128;
    assert_eq!(exchange.settle_funding(&bob()).unwrap(), catch_up);
    assert_eq!(exchange.settle_funding(&alice()).unwrap(), -catch_up);
    assert_eq!(
        exchange.trader_state(&bob()).unwrap().collateral,
        (long_after_one as i128 - catch_up) as u128
    );
    assert_eq!(exchange.settle_funding(&carol()).unwrap(), 0);
    assert_eq!(
        exchange.trader_state(&carol()).unwrap().collateral,
        flat_before
    );
}

fn open_long(collateral: u128, entry_ticks: u64, lots: u64) -> Exchange {
    let mut exchange = Exchange::new(
        "NEAR-PERP".into(),
        "crypto".into(),
        1,
        1_000,
        500,
        50,
        3_600_000_000_000,
    )
    .unwrap();
    exchange.push_mark(entry_ticks, entry_ticks).unwrap();
    let initial = lots as u128 * entry_ticks as u128 / 10;
    exchange.credit(&alice(), initial).unwrap();
    exchange.credit(&bob(), collateral).unwrap();
    exchange
        .place(&alice(), Side::Ask, OrderKind::Limit, entry_ticks, lots)
        .unwrap();
    exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, entry_ticks, lots)
        .unwrap();
    exchange
}

#[test]
fn liquidating_at_the_worked_example_pays_the_caller_and_flattens_the_long() {
    let lots = 10u64;
    let entry = 5_000_000u64;
    let collateral = 10_000_000u128;
    let maintenance_bps = 500u32;
    let mut exchange = open_long(collateral, entry, lots);
    let quote = crate::math::liquidation_quote_per_lot(
        collateral,
        lots as i64,
        entry as u128,
        maintenance_bps,
    )
    .unwrap();
    assert_eq!(quote, 4_210_526);
    exchange.push_mark(quote as u64, entry).unwrap();

    exchange.liquidate(&carol(), &bob()).unwrap();
    let flat = exchange.trader_state(&bob()).unwrap();
    assert_eq!(flat.base_lots, 0);
    assert_eq!(flat.entry_quote_per_lot, 0);
    let notional = lots as u128 * quote;
    let fee = notional * 100 / 10_000;
    let realized = (quote as i128 - entry as i128) * lots as i128;
    let remaining = (collateral as i128 + realized) as u128 - fee;
    assert_eq!(flat.collateral, remaining);
    assert_eq!(exchange.trader_state(&carol()).unwrap().collateral, fee);
    assert_eq!(exchange.market.bad_debt, 0);
    assert_eq!(exchange.market.open_interest_lots, 0);
}

#[test]
fn a_healthy_account_is_not_liquidatable() {
    let mut exchange = open_long(10_000_000, 5_000_000, 10);
    exchange
        .place(&bob(), Side::Bid, OrderKind::Limit, 4_000_000, 1)
        .unwrap();
    let orders = exchange.orders.len();
    assert_eq!(
        exchange.liquidate(&carol(), &bob()),
        Err(ExchangeError::NotLiquidatable)
    );
    assert_eq!(exchange.trader_state(&bob()).unwrap().base_lots, 10);
    assert_eq!(exchange.orders.len(), orders);
}

#[test]
fn liquidation_draws_insurance_and_records_what_it_cannot_pay() {
    let mut exchange = open_long(10_000_000, 5_000_000, 10);
    let mark = 3_800_000u64;
    exchange.push_mark(mark, 5_000_000).unwrap();
    exchange.market.insurance = 1_500_000;
    exchange.liquidate(&carol(), &bob()).unwrap();
    let loss = (5_000_000u128 - mark as u128) * 10;
    let unpaid = loss - 10_000_000;
    assert_eq!(exchange.trader_state(&bob()).unwrap().base_lots, 0);
    assert_eq!(exchange.trader_state(&bob()).unwrap().collateral, 0);
    assert_eq!(exchange.market.insurance, 0);
    assert_eq!(exchange.market.bad_debt, unpaid - 1_500_000);
    assert_eq!(exchange.trader_state(&carol()).unwrap().collateral, 0);

    let mut covered = open_long(10_000_000, 5_000_000, 10);
    covered.push_mark(mark, 5_000_000).unwrap();
    covered.market.insurance = unpaid + 1_000;
    covered.liquidate(&carol(), &bob()).unwrap();
    assert_eq!(covered.market.insurance, 1_000);
    assert_eq!(covered.market.bad_debt, 0);
    assert_eq!(covered.trader_state(&bob()).unwrap().collateral, 0);
}
