use super::exchange::OrderKind;
use super::math::Side;
use super::oracle::{OraclePrice, OracleRecord, PriceData};
use near_sdk::json_types::{I128, U128};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId};

use super::Marks;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn as_account(name: &str) {
    at(name, 0);
}

fn at(name: &str, block_timestamp: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(account(name))
        .block_timestamp(block_timestamp)
        .build());
}

fn marks() -> Marks {
    listed(3_600_000_000_000)
}

fn listed(funding_interval_ns: u64) -> Marks {
    as_account("deployer.testnet");
    let mut marks = Marks::new(
        account("usdc.testnet"),
        account("oracle.testnet"),
        account("fees.testnet"),
    );
    as_account("lister.testnet");
    marks.create_market(
        "NEAR-PERP".into(),
        "crypto".into(),
        U128(1_000_000),
        1_000,
        500,
        50,
        funding_interval_ns,
        "wrap.testnet".into(),
        120_000_000_000,
        U128(0),
        None,
    );
    as_account("usdc.testnet");
    marks
}

fn price(asset_id: &str, ticks: u64) -> OracleRecord {
    OracleRecord {
        asset_id: asset_id.into(),
        price: Some(OraclePrice {
            multiplier: (u128::from(ticks) * 1_000_000).to_string(),
            decimals: 6,
        }),
    }
}

fn set_mark(marks: &mut Marks, mark_ticks: u64, index_ticks: u64) {
    at("oracle.testnet", 1_000_000_000);
    marks.oracle_on_call(
        account("oracle.testnet"),
        PriceData {
            timestamp: "1000000000".into(),
            recency_duration_sec: 90,
            prices: vec![
                price("wrap.testnet", mark_ticks),
                price("wrap.testnet:index", index_ticks),
            ],
        },
        "NEAR-PERP".into(),
    );
}

#[test]
fn new_stores_the_market_before_a_mark_exists() {
    let marks = marks();
    let market = marks.get_market("NEAR-PERP".into());
    assert_eq!(market.symbol, "NEAR-PERP");
    assert_eq!(market.category, "crypto");
    assert_eq!(market.tick_size, U128(1_000_000));
    assert_eq!(market.mark_ticks, 0);
    assert_eq!(marks.get_funding_rate_bps("NEAR-PERP".into()), 0);
    assert!(marks.get_order("NEAR-PERP".into(), 1).is_none());
    assert!(marks.get_l2("NEAR-PERP".into(), 5).bids.is_empty());
}

#[test]
fn the_collateral_token_can_credit_a_trader() {
    let mut marks = marks();
    let unused = marks.ft_on_transfer(account("alice.testnet"), U128(5_000_000), String::new());
    assert_eq!(unused, U128(0));
    let trader = marks.get_trader("NEAR-PERP".into(), account("alice.testnet"));
    assert_eq!(trader.unallocated, U128(5_000_000));
    assert_eq!(trader.collateral, U128(0));
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(5_000_000));
    let committed = marks.get_trader("NEAR-PERP".into(), account("alice.testnet"));
    assert_eq!(committed.unallocated, U128(0));
    assert_eq!(committed.collateral, U128(5_000_000));
}

#[test]
fn release_returns_free_collateral_and_keeps_margin() {
    let mut marks = marks();
    as_account("alice.testnet");
    set_mark(&mut marks, 5, 5);
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(10_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(10_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 4, 10);
    marks.release("NEAR-PERP".into(), U128(5_000_000));
    let trader = marks.get_trader("NEAR-PERP".into(), account("alice.testnet"));
    assert_eq!(trader.collateral, U128(5_000_000));
    assert_eq!(trader.unallocated, U128(5_000_000));
    assert_eq!(trader.free_collateral, U128(0));
}

#[test]
#[should_panic(expected = "insufficient margin")]
fn release_rejects_an_amount_that_breaks_initial_margin() {
    let mut marks = marks();
    as_account("alice.testnet");
    set_mark(&mut marks, 5, 5);
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(10_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(10_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 4, 10);
    marks.release("NEAR-PERP".into(), U128(6_000_000));
}

#[test]
fn a_failed_withdraw_returns_the_unallocated_balance() {
    let mut marks = marks();
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(5_000_000), String::new());
    as_account("alice.testnet");
    let _promise = marks.withdraw(U128(2_000_000));
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .unallocated,
        U128(3_000_000)
    );

    near_sdk::test_utils::testing_env_with_promise_results(
        VMContextBuilder::new()
            .current_account_id(account("marks.testnet"))
            .predecessor_account_id(account("marks.testnet"))
            .build(),
        near_sdk::PromiseResult::Failed,
    );
    marks.on_withdraw(account("alice.testnet"), U128(2_000_000));
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .unallocated,
        U128(5_000_000)
    );
}

#[test]
#[should_panic(expected = "unknown market")]
fn commit_rejects_a_symbol_that_is_not_listed() {
    let mut marks = marks();
    as_account("alice.testnet");
    marks.commit("BTC-PERP".into(), U128(1));
}

#[test]
#[should_panic(expected = "size is zero")]
fn a_zero_deposit_is_rejected() {
    let mut marks = marks();
    marks.ft_on_transfer(account("alice.testnet"), U128(0), String::new());
}

#[test]
#[should_panic(expected = "collateral token only")]
fn a_wallet_cannot_mint_collateral() {
    let mut marks = marks();
    as_account("alice.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(1), String::new());
}

#[test]
fn push_mark_place_and_cancel_round_trip_through_the_contract() {
    let mut marks = marks();
    as_account("alice.testnet");
    set_mark(&mut marks, 5, 5);
    assert_eq!(marks.get_funding_rate_bps("NEAR-PERP".into()), 0);
    assert_eq!(marks.get_market("NEAR-PERP".into()).mark_ticks, 5);

    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(5_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(5_000_000));

    let placed = marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 4, 10);
    let order_id = placed.order_id.unwrap();
    assert_eq!(placed.rested_lots, 10);
    assert_eq!(marks.get_l2("NEAR-PERP".into(), 5).bids[0].lots, 10);
    assert_eq!(
        marks
            .get_order("NEAR-PERP".into(), order_id)
            .unwrap()
            .trader,
        account("alice.testnet")
    );
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .initial_margin,
        U128(5_000_000)
    );

    marks.cancel_order("NEAR-PERP".into(), order_id);
    assert!(marks.get_l2("NEAR-PERP".into(), 5).bids.is_empty());
    assert!(marks.get_order("NEAR-PERP".into(), order_id).is_none());
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .open_bid_lots,
        0
    );
}

#[test]
fn a_crossing_order_fills_through_the_contract() {
    let lots = 1u64;
    let ask_ticks = 6u64;
    let tick_size = 1_000_000u128;
    let entry = ask_ticks as u128 * tick_size;
    let mut marks = marks();
    as_account("alice.testnet");
    set_mark(&mut marks, 5, 5);
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(500_000), String::new());
    marks.ft_on_transfer(account("bob.testnet"), U128(1_500_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(500_000));
    marks.place_order(
        "NEAR-PERP".into(),
        Side::Ask,
        OrderKind::Limit,
        ask_ticks,
        lots,
    );
    as_account("bob.testnet");
    marks.commit("NEAR-PERP".into(), U128(1_500_000));
    let filled = marks.place_order(
        "NEAR-PERP".into(),
        Side::Bid,
        OrderKind::Limit,
        ask_ticks,
        lots,
    );
    assert_eq!(filled.filled_lots, lots);
    assert_eq!(filled.rested_lots, 0);
    assert_eq!(
        marks.get_market("NEAR-PERP".into()).open_interest_lots,
        lots
    );
    assert_eq!(
        marks.get_market("NEAR-PERP".into()).volume_quote,
        U128(entry)
    );
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("bob.testnet"))
            .base_lots,
        lots as i64
    );
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .base_lots,
        -(lots as i64)
    );
    assert!(marks.get_l2("NEAR-PERP".into(), 5).asks.is_empty());
}

#[test]
fn settle_funding_charges_the_long_and_pays_the_short() {
    let interval = 1_000_000_000u64;
    let opened_at = 5_000_000_000u64;
    let mut marks = listed(interval);
    at("alice.testnet", opened_at);
    set_mark(&mut marks, 5, 5);
    at("usdc.testnet", opened_at);
    marks.ft_on_transfer(account("alice.testnet"), U128(20_000_000), String::new());
    marks.ft_on_transfer(account("bob.testnet"), U128(20_000_000), String::new());
    at("alice.testnet", opened_at);
    marks.commit("NEAR-PERP".into(), U128(20_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Ask, OrderKind::Limit, 5, 10);
    at("bob.testnet", opened_at);
    marks.commit("NEAR-PERP".into(), U128(20_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 5, 10);
    at("alice.testnet", opened_at);
    set_mark(&mut marks, 6, 5);
    assert_eq!(marks.get_funding_rate_bps("NEAR-PERP".into()), 50);

    at("bob.testnet", opened_at + interval);
    let long_payment = marks.settle_funding("NEAR-PERP".into());
    at("alice.testnet", opened_at + interval);
    let short_payment = marks.settle_funding("NEAR-PERP".into());
    assert_eq!(long_payment, I128(250_000));
    assert_eq!(short_payment, I128(-250_000));
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("bob.testnet"))
            .collateral,
        U128(19_750_000)
    );
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .collateral,
        U128(20_250_000)
    );
}

#[test]
#[should_panic(expected = "not liquidatable")]
fn a_healthy_trader_cannot_be_liquidated() {
    let mut marks = marks();
    as_account("alice.testnet");
    set_mark(&mut marks, 5, 5);
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(5_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(5_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 4, 1);
    as_account("bob.testnet");
    marks.liquidate("NEAR-PERP".into(), account("alice.testnet"));
}

#[test]
#[should_panic(expected = "post-only order would cross")]
fn a_crossing_post_only_order_panics_on_the_contract() {
    let mut marks = marks();
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(50_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(50_000_000));
    set_mark(&mut marks, 5, 5);
    as_account("alice.testnet");
    marks.place_order("NEAR-PERP".into(), Side::Ask, OrderKind::Limit, 6, 1);
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::PostOnly, 6, 1);
}

#[test]
fn create_market_locks_insurance_and_rejects_a_second_listing() {
    let insurance = 1_000_000u128;
    as_account("usdc.testnet");
    let mut marks = Marks::new(
        account("usdc.testnet"),
        account("oracle.testnet"),
        account("fees.testnet"),
    );
    marks.ft_on_transfer(account("lister.testnet"), U128(insurance), String::new());
    as_account("lister.testnet");
    marks.create_market(
        "NEAR-PERP".into(),
        "crypto".into(),
        U128(1_000_000),
        1_000,
        500,
        50,
        3_600_000_000_000,
        "wrap.testnet".into(),
        120_000_000_000,
        U128(insurance),
        None,
    );
    assert_eq!(
        marks.get_market("NEAR-PERP".into()).insurance,
        U128(insurance)
    );
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("lister.testnet"))
            .unallocated,
        U128(0)
    );
    let listed_again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        marks.create_market(
            "NEAR-PERP".into(),
            "crypto".into(),
            U128(1_000_000),
            1_000,
            500,
            50,
            3_600_000_000_000,
            "wrap.testnet".into(),
            120_000_000_000,
            U128(0),
            None,
        );
    }));
    assert!(listed_again.is_err());
}

#[test]
fn the_first_oracle_price_is_stored_and_a_jump_keeps_the_old_mark() {
    let mut marks = marks();
    set_mark(&mut marks, 5, 5);
    assert_eq!(marks.get_market("NEAR-PERP".into()).mark_ticks, 5);
    assert_eq!(
        marks.get_market("NEAR-PERP".into()).mark_updated_ns,
        U128(1_000_000_000)
    );
    at("oracle.testnet", 2_000_000_000);
    marks.oracle_on_call(
        account("oracle.testnet"),
        PriceData {
            timestamp: "2000000000".into(),
            recency_duration_sec: 90,
            prices: vec![price("wrap.testnet", 7), price("wrap.testnet:index", 7)],
        },
        "NEAR-PERP".into(),
    );
    let market = marks.get_market("NEAR-PERP".into());
    assert_eq!(market.mark_ticks, 5);
    assert_eq!(market.mark_updated_ns, U128(1_000_000_000));
    set_mark(&mut marks, 6, 6);
    assert_eq!(marks.get_market("NEAR-PERP".into()).mark_ticks, 6);
}

#[test]
#[should_panic(expected = "oracle only")]
fn a_wallet_cannot_write_the_mark() {
    let mut marks = marks();
    as_account("alice.testnet");
    marks.oracle_on_call(
        account("alice.testnet"),
        PriceData {
            timestamp: "1000000000".into(),
            recency_duration_sec: 90,
            prices: vec![price("wrap.testnet", 5)],
        },
        "NEAR-PERP".into(),
    );
}

#[test]
#[should_panic(expected = "mark is stale")]
fn a_stale_mark_rejects_a_new_order() {
    let mut marks = marks();
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(50_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(50_000_000));
    at("oracle.testnet", 1);
    marks.oracle_on_call(
        account("oracle.testnet"),
        PriceData {
            timestamp: "1".into(),
            recency_duration_sec: 90,
            prices: vec![price("wrap.testnet", 5)],
        },
        "NEAR-PERP".into(),
    );
    at("alice.testnet", 200_000_000_000);
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 4, 1);
}

#[test]
fn a_stale_mark_still_accepts_an_order_that_does_not_add_risk() {
    let mut marks = marks();
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(50_000_000), String::new());
    marks.ft_on_transfer(account("bob.testnet"), U128(50_000_000), String::new());
    set_mark(&mut marks, 5, 5);
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(50_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Ask, OrderKind::Limit, 5, 1);
    as_account("bob.testnet");
    marks.commit("NEAR-PERP".into(), U128(50_000_000));
    marks.place_order("NEAR-PERP".into(), Side::Bid, OrderKind::Limit, 5, 1);
    at("oracle.testnet", 1);
    marks.oracle_on_call(
        account("oracle.testnet"),
        PriceData {
            timestamp: "1".into(),
            recency_duration_sec: 90,
            prices: vec![price("wrap.testnet", 5)],
        },
        "NEAR-PERP".into(),
    );
    at("bob.testnet", 200_000_000_000);
    let resting = marks.place_order("NEAR-PERP".into(), Side::Ask, OrderKind::Limit, 6, 1);
    assert_eq!(resting.rested_lots, 1);
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("bob.testnet"))
            .base_lots,
        1
    );
}

#[test]
fn a_custom_price_is_stored_and_a_failed_fetch_leaves_the_mark() {
    as_account("lister.testnet");
    let mut marks = Marks::new(
        account("usdc.testnet"),
        account("oracle.testnet"),
        account("fees.testnet"),
    );
    marks.create_market(
        "XAU-PERP".into(),
        "metal".into(),
        U128(1_000_000),
        1_000,
        500,
        50,
        3_600_000_000_000,
        "XAU".into(),
        120_000_000_000,
        U128(0),
        Some("[{\"id\":\"gold\"}]".into()),
    );
    at("oracle.testnet", 2_000_000_000);
    marks.on_custom_data(
        account("oracle.testnet"),
        vec![super::oracle::CustomDataResult {
            id: "gold".into(),
            value: Some(near_sdk::serde_json::json!(190.25)),
            timestamp: Some(2_000_000_000),
            error: None,
        }],
        "XAU-PERP".into(),
    );
    assert_eq!(marks.get_market("XAU-PERP".into()).mark_ticks, 190);
    let failed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        marks.on_custom_data(
            account("oracle.testnet"),
            vec![super::oracle::CustomDataResult {
                id: "gold".into(),
                value: None,
                timestamp: None,
                error: Some("fetch failed".into()),
            }],
            "XAU-PERP".into(),
        );
    }));
    assert!(failed.is_err());
    assert_eq!(marks.get_market("XAU-PERP".into()).mark_ticks, 190);
}

#[test]
fn committed_balances_stay_on_their_own_market() {
    let mut marks = marks();
    as_account("lister.testnet");
    marks.create_market(
        "XAU-PERP".into(),
        "metal".into(),
        U128(1_000_000),
        1_000,
        500,
        50,
        3_600_000_000_000,
        "XAU".into(),
        120_000_000_000,
        U128(0),
        None,
    );
    as_account("usdc.testnet");
    marks.ft_on_transfer(account("alice.testnet"), U128(12_000_000), String::new());
    as_account("alice.testnet");
    marks.commit("NEAR-PERP".into(), U128(5_000_000));
    marks.commit("XAU-PERP".into(), U128(7_000_000));
    assert_eq!(
        marks
            .get_trader("NEAR-PERP".into(), account("alice.testnet"))
            .collateral,
        U128(5_000_000)
    );
    assert_eq!(
        marks
            .get_trader("XAU-PERP".into(), account("alice.testnet"))
            .collateral,
        U128(7_000_000)
    );
}
