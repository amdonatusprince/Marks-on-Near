use super::Side;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Position {
    pub base_lots: i64,
    /// Quote atoms per open base lot. Zero when flat.
    pub entry_quote_per_lot: u128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fill {
    pub position: Position,
    pub realized_pnl: i128,
}

pub fn apply_fill(
    position: Position,
    side: Side,
    lots: u64,
    fill_quote_per_lot: u128,
) -> Option<Fill> {
    if lots == 0 {
        return None;
    }
    let delta = signed_lots(side, lots)?;
    if position.base_lots == 0 {
        return Some(open_at(delta, fill_quote_per_lot));
    }
    if same_direction(position.base_lots, delta) {
        return add_to_position(position, delta, lots, fill_quote_per_lot);
    }
    reduce_or_flip(position, side, lots, delta, fill_quote_per_lot)
}

fn signed_lots(side: Side, lots: u64) -> Option<i64> {
    let magnitude = i64::try_from(lots).ok()?;
    match side {
        Side::Bid => Some(magnitude),
        Side::Ask => magnitude.checked_neg(),
    }
}

fn same_direction(base_lots: i64, delta: i64) -> bool {
    (base_lots > 0 && delta > 0) || (base_lots < 0 && delta < 0)
}

fn open_at(base_lots: i64, fill_quote_per_lot: u128) -> Fill {
    Fill {
        position: Position {
            base_lots,
            entry_quote_per_lot: fill_quote_per_lot,
        },
        realized_pnl: 0,
    }
}

fn add_to_position(
    position: Position,
    delta: i64,
    lots: u64,
    fill_quote_per_lot: u128,
) -> Option<Fill> {
    let old_abs = position.base_lots.unsigned_abs() as u128;
    let add = lots as u128;
    let new_abs = old_abs.checked_add(add)?;
    let numerator = old_abs
        .checked_mul(position.entry_quote_per_lot)?
        .checked_add(add.checked_mul(fill_quote_per_lot)?)?;
    Some(Fill {
        position: Position {
            base_lots: position.base_lots.checked_add(delta)?,
            entry_quote_per_lot: numerator / new_abs,
        },
        realized_pnl: 0,
    })
}

fn reduce_or_flip(
    position: Position,
    side: Side,
    lots: u64,
    delta: i64,
    fill_quote_per_lot: u128,
) -> Option<Fill> {
    let old_abs = position.base_lots.unsigned_abs();
    let close = old_abs.min(lots);
    let entry = i128::try_from(position.entry_quote_per_lot).ok()?;
    let fill = i128::try_from(fill_quote_per_lot).ok()?;
    let realized_pnl = if position.base_lots > 0 {
        fill.checked_sub(entry)?.checked_mul(close as i128)?
    } else {
        entry.checked_sub(fill)?.checked_mul(close as i128)?
    };

    if lots < old_abs {
        return Some(Fill {
            position: Position {
                base_lots: position.base_lots.checked_add(delta)?,
                entry_quote_per_lot: position.entry_quote_per_lot,
            },
            realized_pnl,
        });
    }
    if lots == old_abs {
        return Some(Fill {
            position: Position::default(),
            realized_pnl,
        });
    }

    let remainder = lots - old_abs;
    Some(Fill {
        position: Position {
            base_lots: signed_lots(side, remainder)?,
            entry_quote_per_lot: fill_quote_per_lot,
        },
        realized_pnl,
    })
}
