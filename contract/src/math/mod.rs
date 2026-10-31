//! Integer market math for one linear perpetual.
//!
//! Quote amounts are atoms. A price is quote atoms per base lot. Ticks are the
//! integer price on the book: quote atoms per lot = ticks × tick size.
//! Long size is positive. Short size is negative.

mod fill;
mod funding;
mod margin;
mod pnl;
mod quote;

pub(crate) use fill::{apply_fill, Position};
pub(crate) use funding::funding_payment;
pub use funding::funding_rate_bps;
pub use margin::{free_collateral, liquidation_quote_per_lot, margin_requirement, worst_lots};
pub use pnl::{equity, unrealized_pnl};
pub use quote::{quote_atoms, quote_per_lot};

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, BorshDeserialize, BorshSerialize, Serialize, Deserialize,
)]
#[borsh(crate = "near_sdk::borsh")]
#[serde(crate = "near_sdk::serde", rename_all = "lowercase")]
pub enum Side {
    Bid,
    Ask,
}

#[cfg(test)]
mod tests;
