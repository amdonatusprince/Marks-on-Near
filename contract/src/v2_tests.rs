use ed25519_dalek::{Signer, SigningKey};
use near_sdk::json_types::U128;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, AccountId};

use super::exchange::OrderKind;
use super::gifts::{claim_message, register_message, GiftAsset, GiftStatus};
use super::math::Side;
use super::oracle::{OraclePrice, OracleRecord, PriceData};
use super::Marks;

const USD: u128 = 1_000_000;
const HOUR: u64 = 3_600_000_000_000;
const DAY: u64 = 24 * HOUR;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn at(name: &str, now: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(account("marks.testnet"))
        .predecessor_account_id(account(name))
        .block_timestamp(now)
        .build());
}

fn record(asset_id: &str, atoms: u128) -> OracleRecord {
    OracleRecord {
        asset_id: asset_id.into(),
        price: Some(OraclePrice {
            multiplier: atoms.to_string(),
            decimals: 6,
        }),
    }
}

fn deposit(marks: &mut Marks, who: &str, amount: u128, msg: &str) {
    at("usdc.testnet", 1);
    marks.ft_on_transfer(account(who), U128(amount), msg.into());
}

/// One cent ticks, 10 percent initial and 5 percent maintenance margin.
fn desk() -> Marks {
    at("deployer.testnet", 1);
    let mut marks = Marks::new(
        account("usdc.testnet"),
        account("oracle.testnet"),
        account("fees.testnet"),
    );
    marks.create_market(
        "SOL-PERP".into(),
        "crypto".into(),
        U128(10_000),
        1_000,
        500,
        50,
        HOUR,
        "sol".into(),
        u64::MAX / 2,
        U128(0),
        None,
    );
    marks.list_share("aapl".into(), "Apple".into(), HOUR);
    deposit(&mut marks, "bank.testnet", 10_000 * USD, "pool");
    marks
}

fn set_perp(marks: &mut Marks, dollars_cents: u128) {
    at("oracle.testnet", 2);
    marks.oracle_on_call(
        account("oracle.testnet"),
        PriceData {
            timestamp: "2".into(),
            recency_duration_sec: 90,
            prices: vec![
                record("sol", dollars_cents * 10_000),
                record("sol:index", dollars_cents * 10_000),
            ],
        },
        "SOL-PERP".into(),
    );
}

fn set_share(marks: &mut Marks, dollars: u128, now: u64) {
    at("oracle.testnet", now);
    marks.oracle_on_call(
        account("oracle.testnet"),
        PriceData {
            timestamp: now.to_string(),
            recency_duration_sec: 90,
            prices: vec![record("aapl", dollars * USD)],
        },
        "share:aapl".into(),
    );
}

/// Alice goes long 10 lots at $5.00 with $10 of collateral. Bob is the seller.
fn alice_long(marks: &mut Marks) {
    set_perp(marks, 500);
    for who in ["alice.testnet", "bob.testnet"] {
        deposit(marks, who, 100 * USD, "");
        at(who, 3);
        marks.commit("SOL-PERP".into(), U128(10 * USD));
    }
    at("bob.testnet", 3);
    marks.place_order("SOL-PERP".into(), Side::Ask, OrderKind::Limit, 500, 10);
    at("alice.testnet", 3);
    marks.place_order("SOL-PERP".into(), Side::Bid, OrderKind::Limit, 500, 10);
}

fn balance(marks: &Marks, who: &str) -> u128 {
    marks.balance_of(&account(who))
}

#[test]
fn a_mark_jump_applies_only_after_a_confirming_print() {
    let mut marks = desk();
    set_perp(&mut marks, 500);
    set_perp(&mut marks, 1_000);
    assert_eq!(marks.get_market("SOL-PERP".into()).mark_ticks, 500);
    set_perp(&mut marks, 1_005);
    assert_eq!(marks.get_market("SOL-PERP".into()).mark_ticks, 1_005);
}

#[test]
fn borrowing_against_a_perp_pays_out_and_charges_one_percent() {
    let mut marks = desk();
    alice_long(&mut marks);
    let before = balance(&marks, "alice.testnet");
    let view = marks.get_trader("SOL-PERP".into(), account("alice.testnet"));
    assert_eq!(view.borrow_limit, U128(5 * USD * 10_000 / 10_100));
    at("alice.testnet", 4);
    let gross = marks.borrow("SOL-PERP".into(), U128(4 * USD));
    assert_eq!(gross, U128(4_040_000));
    assert_eq!(balance(&marks, "alice.testnet"), before + 4 * USD);
    assert_eq!(balance(&marks, "fees.testnet"), 40_000);
    let view = marks.get_trader("SOL-PERP".into(), account("alice.testnet"));
    assert_eq!(view.debt, U128(4_040_000));
    assert_eq!(marks.get_pool().lent, U128(4_040_000));
}

#[test]
#[should_panic(expected = "insufficient margin")]
fn a_loan_above_the_limit_is_refused() {
    let mut marks = desk();
    alice_long(&mut marks);
    at("alice.testnet", 4);
    marks.borrow("SOL-PERP".into(), U128(5 * USD));
}

#[test]
#[should_panic(expected = "insufficient margin")]
fn borrowed_margin_cannot_be_released() {
    let mut marks = desk();
    alice_long(&mut marks);
    at("alice.testnet", 4);
    marks.borrow("SOL-PERP".into(), U128(4 * USD));
    marks.release("SOL-PERP".into(), U128(USD));
}

#[test]
fn liquidation_repays_the_pool_before_the_liquidator() {
    let mut marks = desk();
    alice_long(&mut marks);
    at("alice.testnet", 4);
    marks.borrow("SOL-PERP".into(), U128(4 * USD));
    set_perp(&mut marks, 460);
    at("keeper.testnet", 5);
    marks.liquidate("SOL-PERP".into(), account("alice.testnet"));
    let pool = marks.get_pool();
    assert_eq!(pool.lent, U128(0));
    assert_eq!(pool.bad_debt, U128(0));
    assert_eq!(pool.cash, U128(10_000 * USD));
    let alice = marks.get_trader("SOL-PERP".into(), account("alice.testnet"));
    assert_eq!(alice.debt, U128(0));
    assert_eq!(alice.base_lots, 0);
    assert_eq!(alice.collateral, U128(1_500_000));
    let keeper = marks.get_trader("SOL-PERP".into(), account("keeper.testnet"));
    assert_eq!(keeper.collateral, U128(460_000));
}

#[test]
fn shares_buy_and_sell_at_the_mark() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 500 * USD, "");
    set_share(&mut marks, 200, 10);
    at("alice.testnet", 11);
    assert_eq!(
        marks.buy_shares("aapl".into(), U128(100 * USD)),
        U128(500_000)
    );
    assert_eq!(balance(&marks, "alice.testnet"), 400 * USD);
    assert_eq!(
        marks.sell_shares("aapl".into(), U128(250_000)),
        U128(50 * USD)
    );
    assert_eq!(balance(&marks, "alice.testnet"), 450 * USD);
    assert_eq!(marks.get_desk_cash(), U128(50 * USD));
    assert_eq!(marks.get_share("aapl".into()).supply, U128(250_000));
}

#[test]
#[should_panic(expected = "mark is stale")]
fn a_stale_share_mark_refuses_buys() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 500 * USD, "");
    set_share(&mut marks, 200, 10);
    at("alice.testnet", 10 + HOUR + 1);
    marks.buy_shares("aapl".into(), U128(100 * USD));
}

#[test]
fn a_share_loan_liquidates_above_sixty_five_percent() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 1_000 * USD, "");
    set_share(&mut marks, 200, 10);
    at("alice.testnet", 11);
    marks.buy_shares("aapl".into(), U128(1_000 * USD));
    let gross = marks.borrow_against("aapl".into(), U128(5 * USD), U128(400 * USD));
    assert_eq!(gross, U128(404 * USD));
    assert_eq!(balance(&marks, "alice.testnet"), 400 * USD);
    set_share(&mut marks, 150, 12);
    set_share(&mut marks, 120, 14);
    at("keeper.testnet", 15);
    marks.liquidate_loan(account("alice.testnet"), "aapl".into());
    assert_eq!(balance(&marks, "keeper.testnet"), 6 * USD);
    assert_eq!(balance(&marks, "alice.testnet"), 590 * USD);
    assert_eq!(marks.get_pool().lent, U128(0));
    assert_eq!(marks.get_pool().cash, U128(10_000 * USD));
}

#[test]
#[should_panic(expected = "loan above 50 percent of share value")]
fn a_share_loan_stops_at_half_the_value() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 1_000 * USD, "");
    set_share(&mut marks, 200, 10);
    at("alice.testnet", 11);
    marks.buy_shares("aapl".into(), U128(1_000 * USD));
    marks.borrow_against("aapl".into(), U128(5 * USD), U128(500 * USD));
}

#[test]
fn a_capped_call_pays_the_buyer_up_to_the_cap() {
    let mut marks = desk();
    set_share(&mut marks, 200, 10);
    deposit(&mut marks, "seller.testnet", 500 * USD, "");
    deposit(&mut marks, "buyer.testnet", 500 * USD, "");
    at("lister.testnet", 10);
    let id = marks.list_series(
        "aapl".into(),
        U128(200 * USD),
        U128(220 * USD),
        10 + 2 * HOUR,
    );
    at("seller.testnet", 11);
    marks.place_option(id.clone(), Side::Ask, U128(5 * USD), 10);
    assert_eq!(balance(&marks, "seller.testnet"), 300 * USD);
    at("buyer.testnet", 12);
    let fill = marks.place_option(id.clone(), Side::Bid, U128(6 * USD), 10);
    assert_eq!(fill.filled_lots, 10);
    assert_eq!(balance(&marks, "buyer.testnet"), 450 * USD);
    assert_eq!(balance(&marks, "seller.testnet"), 350 * USD);
    marks.write_settlement(&id, 215 * USD);
    at("buyer.testnet", 13 + 2 * HOUR);
    assert_eq!(marks.claim_settlement(id.clone()), U128(150 * USD));
    at("seller.testnet", 13 + 2 * HOUR);
    assert_eq!(marks.claim_settlement(id.clone()), U128(50 * USD));
    assert_eq!(balance(&marks, "buyer.testnet"), 600 * USD);
    assert_eq!(balance(&marks, "seller.testnet"), 400 * USD);
}

#[test]
fn a_capped_call_payout_stops_at_the_cap() {
    let mut marks = desk();
    set_share(&mut marks, 200, 10);
    at("lister.testnet", 10);
    let id = marks.list_series(
        "aapl".into(),
        U128(200 * USD),
        U128(220 * USD),
        10 + 2 * HOUR,
    );
    let series = marks.series.get(&id).unwrap();
    assert_eq!(series.payout(260 * USD), 20 * USD);
    assert_eq!(series.payout(190 * USD), 0);
}

fn claim_key(seed: u8) -> (SigningKey, String) {
    let key = SigningKey::from_bytes(&[seed; 32]);
    let public = hex(&key.verifying_key().to_bytes());
    (key, public)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn gift_usdc(marks: &mut Marks, seed: u8, amount: u128) -> (u64, SigningKey) {
    let (key, public) = claim_key(seed);
    at("alice.testnet", 20);
    let proof = hex(&key
        .sign(register_message(&account("alice.testnet")).as_bytes())
        .to_bytes());
    let id = marks.create_gift(
        GiftAsset::Usdc {
            amount: U128(amount),
        },
        public,
        proof,
        7,
        "00ff".into(),
    );
    (id, key)
}

fn claim_signature(key: &SigningKey, id: u64, recipient: &str) -> String {
    hex(&key
        .sign(claim_message(id, &account(recipient)).as_bytes())
        .to_bytes())
}

#[test]
fn a_usdc_gift_is_claimed_by_the_account_the_signature_names() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 100 * USD, "");
    let (id, key) = gift_usdc(&mut marks, 7, 50 * USD);
    assert_eq!(balance(&marks, "alice.testnet"), 49_500_000);
    assert_eq!(balance(&marks, "fees.testnet"), 500_000);
    let signature = claim_signature(&key, id, "bob.testnet");
    at("relayer.testnet", 21);
    marks.claim_gift(id, account("bob.testnet"), signature);
    assert_eq!(balance(&marks, "bob.testnet"), 50 * USD);
    let gift = marks.get_gift(id).unwrap();
    assert_eq!(gift.status, GiftStatus::Claimed);
    assert_eq!(marks.get_gifts_sent(account("alice.testnet")).len(), 1);
    assert_eq!(marks.get_gifts_received(account("bob.testnet")).len(), 1);
}

#[test]
#[should_panic(expected = "invalid claim signature")]
fn a_copied_signature_pays_no_other_account() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 100 * USD, "");
    let (id, key) = gift_usdc(&mut marks, 7, 50 * USD);
    let signature = claim_signature(&key, id, "bob.testnet");
    at("mallory.testnet", 21);
    marks.claim_gift(id, account("mallory.testnet"), signature);
}

#[test]
#[should_panic(expected = "gift is closed")]
fn a_gift_claims_once() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 100 * USD, "");
    let (id, key) = gift_usdc(&mut marks, 7, 50 * USD);
    let signature = claim_signature(&key, id, "bob.testnet");
    at("relayer.testnet", 21);
    marks.claim_gift(id, account("bob.testnet"), signature.clone());
    marks.claim_gift(id, account("bob.testnet"), signature);
}

#[test]
#[should_panic(expected = "invalid key proof")]
fn a_key_registers_only_with_its_own_proof() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 100 * USD, "");
    let (_, public) = claim_key(7);
    let (other, _) = claim_key(8);
    at("alice.testnet", 20);
    let proof = hex(&other
        .sign(register_message(&account("alice.testnet")).as_bytes())
        .to_bytes());
    marks.create_gift(
        GiftAsset::Usdc { amount: U128(USD) },
        public,
        proof,
        7,
        String::new(),
    );
}

#[test]
fn the_sender_takes_an_unclaimed_gift_back_after_expiry() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 100 * USD, "");
    let (id, _) = gift_usdc(&mut marks, 7, 50 * USD);
    at("alice.testnet", 21 + 7 * DAY);
    marks.refund_gift(id);
    assert_eq!(balance(&marks, "alice.testnet"), 99_500_000);
    assert_eq!(marks.get_gift(id).unwrap().status, GiftStatus::Refunded);
}

#[test]
fn a_share_gift_moves_the_units() {
    let mut marks = desk();
    deposit(&mut marks, "alice.testnet", 300 * USD, "");
    set_share(&mut marks, 50, 19);
    at("alice.testnet", 19);
    marks.buy_shares("aapl".into(), U128(100 * USD));
    let (key, public) = claim_key(9);
    let proof = hex(&key
        .sign(register_message(&account("alice.testnet")).as_bytes())
        .to_bytes());
    let id = marks.create_gift(
        GiftAsset::Shares {
            asset_id: "aapl".into(),
            units: U128(USD),
        },
        public,
        proof,
        30,
        String::new(),
    );
    assert_eq!(balance(&marks, "alice.testnet"), 199_500_000);
    at("relayer.testnet", 21);
    marks.claim_gift(
        id,
        account("bob.testnet"),
        claim_signature(&key, id, "bob.testnet"),
    );
    assert_eq!(
        marks.get_holdings(account("bob.testnet")),
        vec![("aapl".to_string(), U128(USD))]
    );
    assert_eq!(
        marks.get_holdings(account("alice.testnet")),
        vec![("aapl".to_string(), U128(USD))]
    );
}

fn gift_position(marks: &mut Marks) -> (u64, SigningKey) {
    alice_long(marks);
    let (key, public) = claim_key(11);
    at("alice.testnet", 20);
    let proof = hex(&key
        .sign(register_message(&account("alice.testnet")).as_bytes())
        .to_bytes());
    let id = marks.create_gift(
        GiftAsset::Position {
            symbol: "SOL-PERP".into(),
        },
        public,
        proof,
        7,
        String::new(),
    );
    (id, key)
}

#[test]
#[should_panic(expected = "position is gifted")]
fn a_gifted_position_is_frozen() {
    let mut marks = desk();
    gift_position(&mut marks);
    at("alice.testnet", 21);
    marks.place_order("SOL-PERP".into(), Side::Ask, OrderKind::Limit, 500, 10);
}

#[test]
fn a_claimed_position_moves_to_the_recipient() {
    let mut marks = desk();
    let (id, key) = gift_position(&mut marks);
    assert_eq!(balance(&marks, "fees.testnet"), 100_000);
    at("relayer.testnet", 21);
    marks.claim_gift(
        id,
        account("carol.testnet"),
        claim_signature(&key, id, "carol.testnet"),
    );
    let carol = marks.get_trader("SOL-PERP".into(), account("carol.testnet"));
    assert_eq!(carol.base_lots, 10);
    assert_eq!(carol.collateral, U128(10 * USD));
    let alice = marks.get_trader("SOL-PERP".into(), account("alice.testnet"));
    assert_eq!(alice.base_lots, 0);
    assert_eq!(alice.collateral, U128(0));
    assert_eq!(marks.get_market("SOL-PERP".into()).open_interest_lots, 10);
}

#[test]
fn liquidation_voids_a_position_gift() {
    let mut marks = desk();
    let (id, _) = gift_position(&mut marks);
    set_perp(&mut marks, 420);
    at("keeper.testnet", 21);
    marks.liquidate("SOL-PERP".into(), account("alice.testnet"));
    assert_eq!(marks.get_gift(id).unwrap().status, GiftStatus::Voided);
    assert!(marks
        .get_trader("SOL-PERP".into(), account("alice.testnet"))
        .gift_id
        .is_none());
}
