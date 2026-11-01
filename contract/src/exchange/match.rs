use near_sdk::AccountId;

use crate::math::{apply_fill, quote_atoms, quote_per_lot, Position, Side};

use super::error::ExchangeError;
use super::orders::reserve_lots;
use super::types::{OrderKind, PlaceResult};
use super::Exchange;

const MAX_FILLS: usize = 16;

struct PlannedFill {
    order_id: u64,
    lots: u64,
    ticks: u64,
}

impl Exchange {
    pub(super) fn match_and_rest(
        &mut self,
        trader: &AccountId,
        side: Side,
        kind: OrderKind,
        ticks: u64,
        lots: u64,
    ) -> Result<PlaceResult, ExchangeError> {
        if kind == OrderKind::PostOnly && self.next_maker(side, ticks, &[]).is_some() {
            return Err(ExchangeError::PostOnlyWouldCross);
        }
        let planned = self.plan_fills(trader, side, ticks, lots)?;
        let filled_so_far: u64 = planned.iter().map(|fill| fill.lots).sum();
        let resting_preview = if kind == OrderKind::ImmediateOrCancel {
            0
        } else {
            lots - filled_so_far
        };
        if (self.market.mark_ticks == 0 || self.mark_is_stale(self.observed_ns))
            && self.increases_risk(trader, side, &planned, resting_preview)?
        {
            return Err(ExchangeError::MarkStale);
        }
        let filled_lots = planned.iter().map(|fill| fill.lots).sum();
        let unfilled = lots - filled_lots;
        let resting = if kind == OrderKind::ImmediateOrCancel {
            0
        } else {
            unfilled
        };

        let projected = project_account(
            self.traders.get(trader).cloned().unwrap_or_default(),
            side,
            ticks,
            self.market.tick_size,
            &planned,
            resting,
        )?;
        self.ensure_margin(&projected)?;
        let mut booked = project_account(
            self.traders.get(trader).cloned().unwrap_or_default(),
            side,
            ticks,
            self.market.tick_size,
            &planned,
            0,
        )?;
        if resting > 0 {
            reserve_lots(&mut booked, side, resting)?;
        }
        self.ensure_margin(&booked)?;

        self.accrue_funding(self.observed_ns)?;
        self.settle_account(trader)?;
        let mut volume = self.market.volume_quote;
        for fill in &planned {
            let maker = self
                .orders
                .get(&fill.order_id)
                .ok_or(ExchangeError::UnknownOrder)?
                .trader
                .clone();
            self.settle_account(&maker)?;
            self.settle_fill(trader, side, fill)?;
            let traded = quote_atoms(fill.lots, fill.ticks, self.market.tick_size)
                .ok_or(ExchangeError::Overflow)?;
            volume = volume.checked_add(traded).ok_or(ExchangeError::Overflow)?;
        }
        self.market.volume_quote = volume;
        if !planned.is_empty() {
            self.recompute_open_interest()?;
        }

        if resting == 0 {
            return Ok(PlaceResult {
                order_id: None,
                rested_lots: 0,
                filled_lots,
            });
        }
        let mut account = self.traders.get(trader).cloned().unwrap_or_default();
        reserve_lots(&mut account, side, resting)?;
        self.traders.insert(trader.clone(), account);
        let id = self.rest(trader, side, kind, ticks, resting)?;
        Ok(PlaceResult {
            order_id: Some(id),
            rested_lots: resting,
            filled_lots,
        })
    }

    fn plan_fills(
        &self,
        taker: &AccountId,
        side: Side,
        ticks: u64,
        lots: u64,
    ) -> Result<Vec<PlannedFill>, ExchangeError> {
        let mut remaining = lots;
        let mut planned = Vec::new();
        while remaining > 0 {
            let Some(maker) = self.next_maker(side, ticks, &planned) else {
                break;
            };
            if &maker.trader == taker {
                return Err(ExchangeError::SelfTrade);
            }
            if planned.len() == MAX_FILLS {
                return Err(ExchangeError::BookTooDense);
            }
            let take = remaining.min(maker.lots);
            planned.push(PlannedFill {
                order_id: maker.id,
                lots: take,
                ticks: maker.ticks,
            });
            remaining -= take;
        }
        Ok(planned)
    }

    fn next_maker(&self, side: Side, ticks: u64, planned: &[PlannedFill]) -> Option<&super::Order> {
        let consumed = |order_id: u64, lots: u64| {
            planned
                .iter()
                .filter(|fill| fill.order_id == order_id)
                .map(|fill| fill.lots)
                .sum::<u64>()
                >= lots
        };
        let levels: Vec<_> = match side {
            Side::Bid => self.asks.iter().collect(),
            Side::Ask => self.bids.iter().rev().collect(),
        };
        for (price, ids) in levels {
            let crosses = match side {
                Side::Bid => *price <= ticks,
                Side::Ask => *price >= ticks,
            };
            if !crosses {
                return None;
            }
            for id in ids {
                let order = self.orders.get(id)?;
                if !consumed(order.id, order.lots) {
                    return Some(order);
                }
            }
        }
        None
    }

    fn settle_fill(
        &mut self,
        taker: &AccountId,
        taker_side: Side,
        fill: &PlannedFill,
    ) -> Result<(), ExchangeError> {
        let maker_id = self
            .orders
            .get(&fill.order_id)
            .ok_or(ExchangeError::UnknownOrder)?
            .trader
            .clone();
        let maker_side = match taker_side {
            Side::Bid => Side::Ask,
            Side::Ask => Side::Bid,
        };
        let quote =
            quote_per_lot(fill.ticks, self.market.tick_size).ok_or(ExchangeError::Overflow)?;
        let mut taker_account = self.traders.get(taker).cloned().unwrap_or_default();
        let mut maker_account = self
            .traders
            .get(&maker_id)
            .cloned()
            .ok_or(ExchangeError::UnknownOrder)?;
        apply_pnl(&mut taker_account, taker_side, fill.lots, quote)?;
        apply_pnl(&mut maker_account, maker_side, fill.lots, quote)?;
        self.traders.insert(taker.clone(), taker_account);
        self.traders.insert(maker_id, maker_account);
        self.consume_resting(fill.order_id, fill.lots)
    }

    fn mark_is_stale(&self, now_ns: u64) -> bool {
        self.market.mark_updated_ns > 0
            && now_ns.saturating_sub(self.market.mark_updated_ns) > self.market.stale_after_ns
    }

    fn increases_risk(
        &self,
        trader: &AccountId,
        side: Side,
        planned: &[PlannedFill],
        resting: u64,
    ) -> Result<bool, ExchangeError> {
        let account = self.traders.get(trader).cloned().unwrap_or_default();
        let before = crate::math::worst_lots(
            account.base_lots,
            account.open_bid_lots,
            account.open_ask_lots,
        );
        let mut projected = account;
        for fill in planned {
            let quote =
                quote_per_lot(fill.ticks, self.market.tick_size).ok_or(ExchangeError::Overflow)?;
            apply_pnl(&mut projected, side, fill.lots, quote)?;
        }
        if resting > 0 {
            reserve_lots(&mut projected, side, resting)?;
        }
        let after = crate::math::worst_lots(
            projected.base_lots,
            projected.open_bid_lots,
            projected.open_ask_lots,
        );
        Ok(after > before)
    }

    pub(crate) fn recompute_open_interest(&mut self) -> Result<(), ExchangeError> {
        let mut total = 0u64;
        for trader in self.traders.values() {
            if trader.base_lots > 0 {
                total = total
                    .checked_add(trader.base_lots as u64)
                    .ok_or(ExchangeError::Overflow)?;
            }
        }
        self.market.open_interest_lots = total;
        Ok(())
    }
}

fn project_account(
    mut account: super::Trader,
    side: Side,
    order_ticks: u64,
    tick_size: u128,
    planned: &[PlannedFill],
    resting: u64,
) -> Result<super::Trader, ExchangeError> {
    for fill in planned {
        let quote = quote_per_lot(fill.ticks, tick_size).ok_or(ExchangeError::Overflow)?;
        apply_pnl(&mut account, side, fill.lots, quote)?;
    }
    if resting > 0 {
        let quote = quote_per_lot(order_ticks, tick_size).ok_or(ExchangeError::Overflow)?;
        apply_pnl(&mut account, side, resting, quote)?;
    }
    Ok(account)
}

fn apply_pnl(
    account: &mut super::Trader,
    side: Side,
    lots: u64,
    quote_per_lot: u128,
) -> Result<(), ExchangeError> {
    let fill = apply_fill(
        Position {
            base_lots: account.base_lots,
            entry_quote_per_lot: account.entry_quote_per_lot,
        },
        side,
        lots,
        quote_per_lot,
    )
    .ok_or(ExchangeError::Overflow)?;
    account.base_lots = fill.position.base_lots;
    account.entry_quote_per_lot = fill.position.entry_quote_per_lot;
    account.collateral =
        add_pnl(account.collateral, fill.realized_pnl).ok_or(ExchangeError::Overflow)?;
    Ok(())
}

fn add_pnl(collateral: u128, pnl: i128) -> Option<u128> {
    if pnl >= 0 {
        collateral.checked_add(u128::try_from(pnl).ok()?)
    } else {
        collateral.checked_sub(pnl.unsigned_abs())
    }
}
