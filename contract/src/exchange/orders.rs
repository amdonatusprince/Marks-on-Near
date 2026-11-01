use std::collections::VecDeque;

use near_sdk::AccountId;

use crate::math::Side;

use super::error::ExchangeError;
use super::types::{Level, Order, OrderKind, PlaceResult};
use super::Exchange;

impl Exchange {
    pub fn place(
        &mut self,
        trader: &AccountId,
        side: Side,
        kind: OrderKind,
        ticks: u64,
        lots: u64,
    ) -> Result<PlaceResult, ExchangeError> {
        if lots == 0 {
            return Err(ExchangeError::ZeroSize);
        }
        if ticks == 0 {
            return Err(ExchangeError::ZeroPrice);
        }
        if self.market.mark_ticks == 0 {
            return Err(ExchangeError::MarkNotSet);
        }
        self.match_and_rest(trader, side, kind, ticks, lots)
    }

    pub fn cancel(&mut self, trader: &AccountId, order_id: u64) -> Result<Order, ExchangeError> {
        let order = self
            .orders
            .get(&order_id)
            .cloned()
            .ok_or(ExchangeError::UnknownOrder)?;
        if &order.trader != trader {
            return Err(ExchangeError::NotOrderOwner);
        }
        self.accrue_funding(self.observed_ns)?;
        self.settle_account(trader)?;
        self.take_order(order_id)
    }

    pub(crate) fn clear_resting(&mut self, trader: &AccountId) -> Result<(), ExchangeError> {
        let ids: Vec<u64> = self
            .orders
            .values()
            .filter(|order| &order.trader == trader)
            .map(|order| order.id)
            .collect();
        for id in ids {
            self.take_order(id)?;
        }
        Ok(())
    }

    pub fn order(&self, order_id: u64) -> Option<&Order> {
        self.orders.get(&order_id)
    }

    pub fn l2(&self, depth: usize) -> (Vec<Level>, Vec<Level>) {
        let bids = self
            .bids
            .iter()
            .rev()
            .take(depth)
            .map(|(ticks, ids)| Level {
                ticks: *ticks,
                lots: lots_at(&self.orders, ids),
            })
            .collect();
        let asks = self
            .asks
            .iter()
            .take(depth)
            .map(|(ticks, ids)| Level {
                ticks: *ticks,
                lots: lots_at(&self.orders, ids),
            })
            .collect();
        (bids, asks)
    }

    pub(super) fn rest(
        &mut self,
        trader: &AccountId,
        side: Side,
        kind: OrderKind,
        ticks: u64,
        lots: u64,
    ) -> Result<u64, ExchangeError> {
        let id = self.market.next_order_id;
        self.market.next_order_id = id.checked_add(1).ok_or(ExchangeError::Overflow)?;
        let sequence = self.market.next_sequence;
        self.market.next_sequence = sequence.checked_add(1).ok_or(ExchangeError::Overflow)?;
        self.orders.insert(
            id,
            Order {
                id,
                trader: trader.clone(),
                side,
                kind,
                ticks,
                lots,
                sequence,
            },
        );
        let book = match side {
            Side::Bid => &mut self.bids,
            Side::Ask => &mut self.asks,
        };
        book.entry(ticks).or_default().push_back(id);
        Ok(id)
    }

    fn take_order(&mut self, order_id: u64) -> Result<Order, ExchangeError> {
        let order = self
            .orders
            .remove(&order_id)
            .ok_or(ExchangeError::UnknownOrder)?;
        let book = match order.side {
            Side::Bid => &mut self.bids,
            Side::Ask => &mut self.asks,
        };
        let level = book
            .get_mut(&order.ticks)
            .ok_or(ExchangeError::UnknownOrder)?;
        level.retain(|id| *id != order_id);
        if level.is_empty() {
            book.remove(&order.ticks);
        }
        release_lots(self, &order, order.lots)?;
        Ok(order)
    }

    pub(super) fn consume_resting(
        &mut self,
        order_id: u64,
        lots: u64,
    ) -> Result<(), ExchangeError> {
        let order = self
            .orders
            .get(&order_id)
            .cloned()
            .ok_or(ExchangeError::UnknownOrder)?;
        if lots == 0 || lots > order.lots {
            return Err(ExchangeError::Overflow);
        }
        release_lots(self, &order, lots)?;
        if lots == order.lots {
            self.orders.remove(&order_id);
            let book = match order.side {
                Side::Bid => &mut self.bids,
                Side::Ask => &mut self.asks,
            };
            let level = book
                .get_mut(&order.ticks)
                .ok_or(ExchangeError::UnknownOrder)?;
            level.retain(|id| *id != order_id);
            if level.is_empty() {
                book.remove(&order.ticks);
            }
        } else {
            let mut updated = order;
            updated.lots -= lots;
            self.orders.insert(order_id, updated);
        }
        Ok(())
    }
}

pub(super) fn reserve_lots(
    account: &mut super::Trader,
    side: Side,
    lots: u64,
) -> Result<(), ExchangeError> {
    let open = match side {
        Side::Bid => &mut account.open_bid_lots,
        Side::Ask => &mut account.open_ask_lots,
    };
    *open = open.checked_add(lots).ok_or(ExchangeError::Overflow)?;
    Ok(())
}

fn release_lots(exchange: &mut Exchange, order: &Order, lots: u64) -> Result<(), ExchangeError> {
    let account = exchange
        .traders
        .get_mut(&order.trader)
        .ok_or(ExchangeError::UnknownOrder)?;
    let open = match order.side {
        Side::Bid => &mut account.open_bid_lots,
        Side::Ask => &mut account.open_ask_lots,
    };
    *open = open.checked_sub(lots).ok_or(ExchangeError::Overflow)?;
    Ok(())
}

fn lots_at(orders: &std::collections::BTreeMap<u64, Order>, ids: &VecDeque<u64>) -> u64 {
    ids.iter().map(|id| orders[id].lots).sum()
}
