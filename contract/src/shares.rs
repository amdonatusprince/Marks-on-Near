//! Tokenized shares bought and sold at the oracle mark against the share desk.
//!
//! A share unit has six decimals: 1_000_000 units are one share. The desk
//! holds USDC from buyers and pays sellers. A stale mark refuses buys and
//! share loans. Sells stay open so a holder can always exit.

use std::collections::BTreeMap;

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, NearToken, Promise};

use crate::balances::emit;
use crate::{ext_oracle, Marks, MarksExt};

pub const UNIT: u128 = 1_000_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShareAsset {
    pub asset_id: String,
    pub name: String,
    /// Quote atoms for one whole share.
    pub price: U128,
    pub updated_ns: u64,
    pub stale_after_ns: u64,
    pub supply: U128,
    /// A print outside the 25 percent band, applied once a second print lands within 1 percent.
    pub pending: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShareLoan {
    pub units: U128,
    pub debt: U128,
}

#[near(serializers = [borsh])]
#[derive(Default)]
pub struct ShareBook {
    pub assets: BTreeMap<String, ShareAsset>,
    pub holdings: BTreeMap<AccountId, BTreeMap<String, u128>>,
    pub loans: BTreeMap<AccountId, BTreeMap<String, ShareLoan>>,
    pub desk_cash: u128,
}

pub fn value_of(units: u128, price: u128) -> u128 {
    units
        .checked_mul(price)
        .unwrap_or_else(|| env::panic_str("overflow"))
        / UNIT
}

impl ShareBook {
    pub fn asset(&self, asset_id: &str) -> &ShareAsset {
        self.assets
            .get(asset_id)
            .unwrap_or_else(|| env::panic_str("unknown share"))
    }

    pub fn fresh_price(&self, asset_id: &str, now_ns: u64) -> u128 {
        let asset = self.asset(asset_id);
        if asset.price.0 == 0 || now_ns.saturating_sub(asset.updated_ns) > asset.stale_after_ns {
            env::panic_str("mark is stale");
        }
        asset.price.0
    }

    pub fn held(&self, account: &AccountId, asset_id: &str) -> u128 {
        self.holdings
            .get(account)
            .and_then(|held| held.get(asset_id))
            .copied()
            .unwrap_or(0)
    }

    pub fn add_units(&mut self, account: &AccountId, asset_id: &str, units: u128) {
        if units == 0 {
            return;
        }
        let held = self.holdings.entry(account.clone()).or_default();
        let next = held
            .get(asset_id)
            .copied()
            .unwrap_or(0)
            .checked_add(units)
            .unwrap_or_else(|| env::panic_str("overflow"));
        held.insert(asset_id.to_string(), next);
    }

    pub fn remove_units(&mut self, account: &AccountId, asset_id: &str, units: u128) {
        if units == 0 {
            env::panic_str("size is zero");
        }
        let have = self.held(account, asset_id);
        if have < units {
            env::panic_str("not enough shares");
        }
        let held = self.holdings.entry(account.clone()).or_default();
        if have == units {
            held.remove(asset_id);
        } else {
            held.insert(asset_id.to_string(), have - units);
        }
        if held.is_empty() {
            self.holdings.remove(account);
        }
    }

    pub fn change_supply(&mut self, asset_id: &str, add: u128, remove: u128) {
        let asset = self
            .assets
            .get_mut(asset_id)
            .unwrap_or_else(|| env::panic_str("unknown share"));
        asset.supply = U128(
            asset
                .supply
                .0
                .checked_add(add)
                .and_then(|value| value.checked_sub(remove))
                .unwrap_or_else(|| env::panic_str("overflow")),
        );
    }
}

#[near]
impl Marks {
    /// List an oracle asset as a share. Listing is permanent and open to anyone.
    pub fn list_share(&mut self, asset_id: String, name: String, stale_after_ns: u64) {
        if asset_id.is_empty() || asset_id.len() > 64 || name.is_empty() || name.len() > 32 {
            env::panic_str("invalid share");
        }
        if self.shares.assets.contains_key(&asset_id) {
            env::panic_str("share already listed");
        }
        if stale_after_ns == 0 {
            env::panic_str("invalid share");
        }
        self.shares.assets.insert(
            asset_id.clone(),
            ShareAsset {
                asset_id: asset_id.clone(),
                name: name.clone(),
                price: U128(0),
                updated_ns: 0,
                stale_after_ns,
                supply: U128(0),
                pending: U128(0),
            },
        );
        emit(
            "share_listed",
            json!({ "asset_id": asset_id, "name": name }),
        );
    }

    /// Ask the oracle for a share's price. The caller attaches the oracle fee.
    #[payable]
    pub fn refresh_share(&mut self, asset_id: String) -> Promise {
        self.shares.asset(&asset_id);
        ext_oracle::ext(self.oracle.clone())
            .with_attached_deposit(NearToken::from_millinear(20))
            .with_unused_gas_weight(1)
            .oracle_call(
                env::current_account_id(),
                Some(vec![asset_id.clone()]),
                format!("share:{asset_id}"),
                None,
            )
    }

    /// Spend USDC from the unallocated balance on shares at the mark.
    pub fn buy_shares(&mut self, asset_id: String, amount: U128) -> U128 {
        let buyer = env::predecessor_account_id();
        let price = self.shares.fresh_price(&asset_id, env::block_timestamp());
        let units = amount
            .0
            .checked_mul(UNIT)
            .unwrap_or_else(|| env::panic_str("overflow"))
            / price;
        if units == 0 {
            env::panic_str("size is zero");
        }
        let cost = value_of(units, price).max(1);
        self.take_unallocated(&buyer, cost);
        self.shares.desk_cash = self
            .shares
            .desk_cash
            .checked_add(cost)
            .unwrap_or_else(|| env::panic_str("overflow"));
        self.shares.add_units(&buyer, &asset_id, units);
        self.shares.change_supply(&asset_id, units, 0);
        emit(
            "shares_bought",
            json!({ "account_id": buyer, "asset_id": asset_id, "units": units.to_string(), "cost": cost.to_string(), "price": price.to_string() }),
        );
        U128(units)
    }

    /// Sell shares at the last mark. Proceeds land in the unallocated balance.
    pub fn sell_shares(&mut self, asset_id: String, units: U128) -> U128 {
        let seller = env::predecessor_account_id();
        let price = self.shares.asset(&asset_id).price.0;
        if price == 0 {
            env::panic_str("mark is not set");
        }
        let paid = value_of(units.0, price);
        if paid == 0 {
            env::panic_str("size is zero");
        }
        if self.shares.desk_cash < paid {
            env::panic_str("desk is short");
        }
        self.shares.remove_units(&seller, &asset_id, units.0);
        self.shares.change_supply(&asset_id, 0, units.0);
        self.shares.desk_cash -= paid;
        self.credit_unallocated(&seller, paid);
        emit(
            "shares_sold",
            json!({ "account_id": seller, "asset_id": asset_id, "units": units.0.to_string(), "paid": paid.to_string(), "price": price.to_string() }),
        );
        U128(paid)
    }

    pub fn get_shares(&self) -> Vec<ShareAsset> {
        self.shares.assets.values().cloned().collect()
    }

    pub fn get_share(&self, asset_id: String) -> ShareAsset {
        self.shares.asset(&asset_id).clone()
    }

    pub fn get_holdings(&self, account_id: AccountId) -> Vec<(String, U128)> {
        self.shares
            .holdings
            .get(&account_id)
            .map(|held| {
                held.iter()
                    .map(|(id, units)| (id.clone(), U128(*units)))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_share_loans(&self, account_id: AccountId) -> Vec<(String, ShareLoan)> {
        self.shares
            .loans
            .get(&account_id)
            .map(|loans| {
                loans
                    .iter()
                    .map(|(id, loan)| (id.clone(), loan.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_desk_cash(&self) -> U128 {
        U128(self.shares.desk_cash)
    }
}

impl Marks {
    pub(crate) fn write_share_price(&mut self, asset_id: &str, price: u128, updated_ns: u64) {
        if price == 0 {
            env::panic_str("price missing");
        }
        let asset = self
            .shares
            .assets
            .get_mut(asset_id)
            .unwrap_or_else(|| env::panic_str("unknown share"));
        let previous = asset.price.0;
        let in_band = previous == 0 || within(previous, price, JUMP_BPS);
        let confirmed = asset.pending.0 > 0 && within(asset.pending.0, price, CONFIRM_BPS);
        if in_band || confirmed {
            asset.price = U128(price);
            asset.updated_ns = updated_ns;
            asset.pending = U128(0);
        } else {
            asset.pending = U128(price);
        }
    }
}

const JUMP_BPS: u128 = 2_500;
const CONFIRM_BPS: u128 = 100;

fn within(reference: u128, next: u128, band_bps: u128) -> bool {
    reference.abs_diff(next).saturating_mul(10_000) <= reference.saturating_mul(band_bps)
}
