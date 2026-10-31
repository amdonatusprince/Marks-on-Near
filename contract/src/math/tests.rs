use super::fill::{apply_fill, Position};
use super::funding::{funding_payment, funding_rate_bps};
use super::margin::{free_collateral, liquidation_quote_per_lot, margin_requirement, worst_lots};
use super::pnl::{equity, unrealized_pnl};
use super::quote::{quote_atoms, quote_per_lot};
use super::Side;

#[test]
fn quote_atoms_are_lots_times_ticks_times_tick_size() {
    assert_eq!(quote_per_lot(5, 1_000_000), Some(5_000_000));
    assert_eq!(quote_atoms(10, 5, 1_000_000), Some(50_000_000));
    assert_eq!(quote_per_lot(2, u128::MAX), None);
}

#[test]
fn long_unrealized_pnl_matches_the_writeup() {
    let pnl = unrealized_pnl(10, 5, 6).unwrap();
    assert_eq!(pnl, 10);
    let short = unrealized_pnl(-10, 5, 6).unwrap();
    assert_eq!(short, -10);
    assert_eq!(equity(10, pnl), Some(20));
}

#[test]
fn adding_size_weights_the_entry() {
    let opened = apply_fill(Position::default(), Side::Bid, 10, 4).unwrap();
    let added = apply_fill(opened.position, Side::Bid, 10, 6).unwrap();
    assert_eq!(added.realized_pnl, 0);
    assert_eq!(added.position.base_lots, 20);
    assert_eq!(added.position.entry_quote_per_lot, 5);
}

#[test]
fn reducing_a_long_keeps_entry_and_realizes_profit() {
    let position = Position {
        base_lots: 20,
        entry_quote_per_lot: 55,
    };
    let fill = apply_fill(position, Side::Ask, 10, 70).unwrap();
    assert_eq!(fill.realized_pnl, 150);
    assert_eq!(fill.position.base_lots, 10);
    assert_eq!(fill.position.entry_quote_per_lot, 55);
    assert_eq!(unrealized_pnl(10, 55, 60).unwrap(), 50);
}

#[test]
fn a_sell_through_flat_opens_a_short_at_the_fill() {
    let position = Position {
        base_lots: 10,
        entry_quote_per_lot: 5,
    };
    let fill = apply_fill(position, Side::Ask, 15, 7).unwrap();
    assert_eq!(fill.realized_pnl, 20);
    assert_eq!(fill.position.base_lots, -5);
    assert_eq!(fill.position.entry_quote_per_lot, 7);
}

#[test]
fn closing_exactly_goes_flat() {
    let position = Position {
        base_lots: 10,
        entry_quote_per_lot: 5,
    };
    let fill = apply_fill(position, Side::Ask, 10, 7).unwrap();
    assert_eq!(fill.realized_pnl, 20);
    assert_eq!(fill.position, Position::default());
}

#[test]
fn long_liquidation_price_matches_the_worked_example() {
    let price = liquidation_quote_per_lot(10_000_000, 10, 5_000_000, 500).unwrap();
    assert_eq!(price, 4_210_526);
    let pnl = unrealized_pnl(10, 5_000_000, price).unwrap();
    let account_equity = equity(10_000_000, pnl).unwrap();
    let maintenance = margin_requirement(10 * price, 500).unwrap();
    assert!((account_equity - maintenance as i128).abs() <= 10);
}

#[test]
fn short_liquidation_price_matches_the_worked_example() {
    let price = liquidation_quote_per_lot(10_000_000, -10, 5_000_000, 500).unwrap();
    assert_eq!(price, 5_714_285);
}

#[test]
fn a_flat_position_has_no_liquidation_price() {
    assert_eq!(liquidation_quote_per_lot(10, 0, 0, 500), None);
}

#[test]
fn funding_clamps_and_longs_pay_when_mark_is_above_index() {
    let rate = funding_rate_bps(101, 100, 50).unwrap();
    assert_eq!(rate, 50);
    let payment = funding_payment(10, 100, 1, rate).unwrap();
    assert_eq!(payment, 5);
    assert_eq!(funding_payment(-10, 100, 1, rate).unwrap(), -5);
    assert_eq!(funding_rate_bps(5, 0, 50), Some(0));
}

#[test]
fn free_collateral_keeps_initial_margin_and_cannot_exceed_the_balance() {
    assert_eq!(
        free_collateral(20_000_000, 10_000_000, 4_000_000),
        6_000_000
    );
    assert_eq!(free_collateral(5, 100, 4), 5);
    assert_eq!(free_collateral(5, 3, 4), 0);
}

#[test]
fn worst_lots_uses_the_heavier_side() {
    assert_eq!(worst_lots(10, 0, 15), 10);
    assert_eq!(worst_lots(0, 4, 9), 9);
    assert_eq!(worst_lots(-3, 8, 1), 5);
}
