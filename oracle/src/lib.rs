//! A price feed Marks can call.
//!
//! The owner writes the latest dollar price of one contract and a short
//! list of recent prints. `refresh_mark` calls `oracle_call`. This contract
//! calls `oracle_on_call` with the stored price and the same price as the
//! index. It does not fetch a URL and it does not invent a number.

use std::collections::BTreeMap;

use near_sdk::{env, ext_contract, near, AccountId, Gas, PanicOnDefault, Promise};

const HISTORY_LIMIT: usize = 48;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Print {
    pub timestamp_ms: u64,
    pub multiplier: String,
    pub decimals: u32,
}

#[near(serializers = [json])]
#[derive(Clone)]
struct OraclePrice {
    multiplier: String,
    decimals: u32,
}

#[near(serializers = [json])]
#[derive(Clone)]
struct OracleRecord {
    asset_id: String,
    price: Option<OraclePrice>,
}

#[near(serializers = [json])]
#[derive(Clone)]
struct PriceData {
    timestamp: String,
    recency_duration_sec: u32,
    prices: Vec<OracleRecord>,
}

#[allow(dead_code)]
#[ext_contract(ext_marks)]
trait MarksCallback {
    fn oracle_on_call(&mut self, sender_id: AccountId, data: PriceData, msg: String);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Oracle {
    owner: AccountId,
    latest: BTreeMap<String, Print>,
    history: BTreeMap<String, Vec<Print>>,
}

#[near]
impl Oracle {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            latest: BTreeMap::new(),
            history: BTreeMap::new(),
        }
    }

    /// Replace the stored prints for one asset. The last print is the price
    /// `oracle_call` returns.
    pub fn set_series(&mut self, asset_id: String, points: Vec<Print>) {
        self.only_owner();
        if asset_id.is_empty() || points.is_empty() {
            env::panic_str("price missing");
        }
        let mut kept = points;
        if kept.len() > HISTORY_LIMIT {
            let start = kept.len() - HISTORY_LIMIT;
            kept = kept.split_off(start);
        }
        for point in &kept {
            check_price(&point.multiplier, point.decimals);
        }
        let latest = kept
            .last()
            .cloned()
            .unwrap_or_else(|| env::panic_str("price missing"));
        self.history.insert(asset_id.clone(), kept);
        self.latest.insert(asset_id, latest);
    }

    /// Accepts the 0.02 NEAR that Marks attaches in `refresh_mark`.
    #[payable]
    pub fn oracle_call(
        &mut self,
        receiver_id: AccountId,
        asset_ids: Option<Vec<String>>,
        msg: String,
        resource_limits: Option<near_sdk::serde_json::Value>,
    ) -> Promise {
        let _ = resource_limits;
        let asset_id = asset_ids
            .and_then(|ids| ids.into_iter().next())
            .unwrap_or_else(|| env::panic_str("price missing"));
        let print = self
            .latest
            .get(&asset_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("price missing"));
        let price = OraclePrice {
            multiplier: print.multiplier,
            decimals: print.decimals,
        };
        let data = PriceData {
            timestamp: env::block_timestamp().to_string(),
            recency_duration_sec: 3_600,
            prices: vec![
                OracleRecord {
                    asset_id: asset_id.clone(),
                    price: Some(price.clone()),
                },
                OracleRecord {
                    asset_id: format!("{asset_id}:index"),
                    price: Some(price),
                },
            ],
        };
        ext_marks::ext(receiver_id)
            .with_static_gas(Gas::from_tgas(100))
            .oracle_on_call(env::current_account_id(), data, msg)
    }

    pub fn custom_call(
        &mut self,
        receiver_id: AccountId,
        custom_data_request: Vec<near_sdk::serde_json::Value>,
        msg: String,
        resource_limits: Option<near_sdk::serde_json::Value>,
    ) {
        let _ = (receiver_id, custom_data_request, msg, resource_limits);
        env::panic_str("price missing");
    }

    pub fn get_history(&self, asset_id: String) -> Vec<Print> {
        self.history.get(&asset_id).cloned().unwrap_or_default()
    }

    pub fn get_price(&self, asset_id: String) -> Option<Print> {
        self.latest.get(&asset_id).cloned()
    }
}

impl Oracle {
    fn only_owner(&self) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str("owner only");
        }
    }
}

fn check_price(multiplier: &str, decimals: u32) {
    let value: u128 = multiplier
        .parse()
        .unwrap_or_else(|_| env::panic_str("price missing"));
    if value == 0 || decimals > 18 {
        env::panic_str("price missing");
    }
}

#[cfg(test)]
mod tests {
    use super::{Oracle, Print};
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId};

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn setup(predecessor: &str) -> Oracle {
        let context = VMContextBuilder::new()
            .current_account_id(account("oracle.testnet"))
            .predecessor_account_id(account(predecessor))
            .block_timestamp(1_700_000_000_000_000_000)
            .build();
        testing_env!(context);
        Oracle::new(account("oracle.testnet"))
    }

    fn point(multiplier: &str, timestamp_ms: u64) -> Print {
        Print {
            timestamp_ms,
            multiplier: multiplier.to_string(),
            decimals: 8,
        }
    }

    #[test]
    fn the_owner_stores_the_latest_print_and_the_history() {
        let mut oracle = setup("oracle.testnet");
        oracle.set_series(
            "sol".into(),
            vec![point("7400000000", 1), point("7500000000", 2)],
        );
        let history = oracle.get_history("sol".into());
        assert_eq!(history.len(), 2);
        assert_eq!(
            oracle.get_price("sol".into()).unwrap().multiplier,
            "7500000000"
        );
        assert!(oracle.get_history("missing".into()).is_empty());
    }

    #[test]
    fn history_keeps_the_latest_forty_eight_prints() {
        let mut oracle = setup("oracle.testnet");
        let points: Vec<Print> = (0..60).map(|index| point("100000000", index)).collect();
        oracle.set_series("near".into(), points);
        let history = oracle.get_history("near".into());
        assert_eq!(history.len(), 48);
        assert_eq!(history[0].timestamp_ms, 12);
        assert_eq!(history.last().unwrap().timestamp_ms, 59);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn a_stranger_cannot_write_a_price() {
        let mut oracle = setup("other.testnet");
        oracle.set_series("sol".into(), vec![point("7500000000", 1)]);
    }

    #[test]
    #[should_panic(expected = "price missing")]
    fn a_zero_price_is_rejected() {
        let mut oracle = setup("oracle.testnet");
        oracle.set_series("sol".into(), vec![point("0", 1)]);
    }
}
