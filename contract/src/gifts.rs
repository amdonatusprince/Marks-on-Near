//! Gifts by link, on Moi's claim-key model.
//!
//! The sender's browser makes a one-time ed25519 key. The public half is stored
//! here; the private half travels only in the link fragment. `key_proof` signs
//! `marks-gift-register:{contract}:{sender}` so a key cannot be registered by
//! someone who does not hold it. A claim signs
//! `marks-gift-claim:{contract}:{gift_id}:{recipient}`, which binds the
//! recipient: anyone may submit the claim and pay gas, and a copied signature
//! pays only the account it names. Each key works once.
//!
//! A position gift freezes the perp in the sender's account: no orders,
//! releases or loans. Liquidation still runs and voids the gift.

use std::collections::{BTreeMap, BTreeSet};

use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId};

use crate::balances::{emit, platform_fee};
use crate::shares::value_of;
use crate::{Marks, MarksExt};

const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
const MAX_NOTE_BYTES: usize = 512;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GiftAsset {
    Usdc { amount: U128 },
    Shares { asset_id: String, units: U128 },
    Position { symbol: String },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GiftStatus {
    Open,
    Claimed,
    Refunded,
    Voided,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Gift {
    pub id: u64,
    pub sender: AccountId,
    /// Hex of the 32-byte ed25519 claim key.
    pub claim_key: String,
    pub asset: GiftAsset,
    pub fee: U128,
    pub created_ns: u64,
    pub expiry_ns: u64,
    /// Hex of the AES-GCM sealed note. Only the link holder can open it.
    pub note: String,
    pub status: GiftStatus,
    pub recipient: Option<AccountId>,
    pub closed_ns: u64,
}

#[near(serializers = [borsh])]
#[derive(Default)]
pub struct GiftBook {
    pub gifts: BTreeMap<u64, Gift>,
    pub next_id: u64,
    pub used_keys: BTreeSet<String>,
    /// `symbol|account` to the open gift that freezes it.
    pub frozen: BTreeMap<String, u64>,
}

pub fn frozen_key(symbol: &str, account: &AccountId) -> String {
    format!("{symbol}|{account}")
}

fn decode_hex<const N: usize>(raw: &str, what: &str) -> [u8; N] {
    let bytes = raw.as_bytes();
    if bytes.len() != N * 2 {
        env::panic_str(&format!("invalid {what}"));
    }
    let mut out = [0u8; N];
    for (index, pair) in bytes.chunks(2).enumerate() {
        let text = std::str::from_utf8(pair).unwrap_or_else(|_| env::panic_str("invalid hex"));
        out[index] = u8::from_str_radix(text, 16)
            .unwrap_or_else(|_| env::panic_str(&format!("invalid {what}")));
    }
    out
}

fn verify(signature_hex: &str, message: &str, key_hex: &str) -> bool {
    let signature: [u8; 64] = decode_hex(signature_hex, "signature");
    let key: [u8; 32] = decode_hex(key_hex, "claim key");
    env::ed25519_verify(&signature, message.as_bytes(), &key)
}

pub fn register_message(sender: &AccountId) -> String {
    format!(
        "marks-gift-register:{}:{}",
        env::current_account_id(),
        sender
    )
}

pub fn claim_message(gift_id: u64, recipient: &AccountId) -> String {
    format!(
        "marks-gift-claim:{}:{}:{}",
        env::current_account_id(),
        gift_id,
        recipient
    )
}

impl Marks {
    pub(crate) fn ensure_not_gifted(&self, symbol: &str, account: &AccountId) {
        if self.gifts.frozen.contains_key(&frozen_key(symbol, account)) {
            env::panic_str("position is gifted");
        }
    }

    pub(crate) fn frozen_gift(&self, symbol: &str, account: &AccountId) -> Option<u64> {
        self.gifts.frozen.get(&frozen_key(symbol, account)).copied()
    }

    /// A liquidated position can no longer be given. The fee stays paid.
    pub(crate) fn void_position_gift(&mut self, symbol: &str, account: &AccountId) {
        if let Some(id) = self.gifts.frozen.remove(&frozen_key(symbol, account)) {
            if let Some(gift) = self.gifts.gifts.get_mut(&id) {
                gift.status = GiftStatus::Voided;
                gift.closed_ns = env::block_timestamp();
            }
            emit("gift_voided", json!({ "gift_id": id, "sender": account }));
        }
    }

    fn open_gift(&self, gift_id: u64) -> Gift {
        let gift = self
            .gifts
            .gifts
            .get(&gift_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("unknown gift"));
        if gift.status != GiftStatus::Open {
            env::panic_str("gift is closed");
        }
        gift
    }

    fn deliver(&mut self, gift: &Gift, to: &AccountId) {
        match &gift.asset {
            GiftAsset::Usdc { amount } => self.credit_unallocated(to, amount.0),
            GiftAsset::Shares { asset_id, units } => self.shares.add_units(to, asset_id, units.0),
            GiftAsset::Position { symbol } => {
                self.gifts.frozen.remove(&frozen_key(symbol, &gift.sender));
                if to != &gift.sender {
                    let book = self.book_mut(symbol);
                    book.note_time(env::block_timestamp());
                    let account = crate::must(book.take_account(&gift.sender));
                    crate::must(book.give_account(to, account));
                }
            }
        }
    }
}

#[near]
impl Marks {
    /// Lock an asset behind a claim key. The 1 percent fee is paid now from unallocated USDC.
    pub fn create_gift(
        &mut self,
        asset: GiftAsset,
        claim_key: String,
        key_proof: String,
        expiry_days: u32,
        note: String,
    ) -> u64 {
        let sender = env::predecessor_account_id();
        let claim_key = claim_key.to_lowercase();
        if !(1..=90).contains(&expiry_days) {
            env::panic_str("expiry must be 1 to 90 days");
        }
        if note.len() > MAX_NOTE_BYTES * 2 || !note.bytes().all(|b| b.is_ascii_hexdigit()) {
            env::panic_str("note is too long");
        }
        if self.gifts.used_keys.contains(&claim_key) {
            env::panic_str("claim key already used");
        }
        if !verify(&key_proof, &register_message(&sender), &claim_key) {
            env::panic_str("invalid key proof");
        }
        let now = env::block_timestamp();
        let fee = match &asset {
            GiftAsset::Usdc { amount } => {
                let fee = platform_fee(amount.0);
                self.take_unallocated(&sender, amount.0);
                fee
            }
            GiftAsset::Shares { asset_id, units } => {
                let price = self.shares.fresh_price(asset_id, now);
                self.shares.remove_units(&sender, asset_id, units.0);
                platform_fee(value_of(units.0, price))
            }
            GiftAsset::Position { symbol } => {
                self.ensure_not_gifted(symbol, &sender);
                let book = self.book_mut(symbol);
                book.note_time(now);
                crate::must(book.settle_funding(&sender).map(|_| ()));
                crate::must(book.clear_resting(&sender));
                let state = crate::must(book.trader_state(&sender));
                if state.base_lots == 0 || state.equity <= 0 {
                    env::panic_str("no position to gift");
                }
                platform_fee(u128::try_from(state.equity).unwrap_or(0))
            }
        };
        self.charge_fee(&sender, fee);
        let id = self.gifts.next_id;
        self.gifts.next_id += 1;
        if let GiftAsset::Position { symbol } = &asset {
            self.gifts.frozen.insert(frozen_key(symbol, &sender), id);
        }
        self.gifts.used_keys.insert(claim_key.clone());
        let gift = Gift {
            id,
            sender: sender.clone(),
            claim_key,
            asset,
            fee: U128(fee),
            created_ns: now,
            expiry_ns: now + u64::from(expiry_days) * DAY_NS,
            note,
            status: GiftStatus::Open,
            recipient: None,
            closed_ns: 0,
        };
        emit(
            "gift_created",
            json!({ "gift_id": id, "sender": sender, "asset": gift.asset, "fee": fee.to_string(), "expiry_ns": gift.expiry_ns.to_string() }),
        );
        self.gifts.gifts.insert(id, gift);
        id
    }

    /// Claim with a signature from the link's key over this gift and the recipient.
    pub fn claim_gift(&mut self, gift_id: u64, recipient: AccountId, signature: String) {
        let gift = self.open_gift(gift_id);
        if env::block_timestamp() >= gift.expiry_ns {
            env::panic_str("gift expired");
        }
        if !verify(
            &signature,
            &claim_message(gift_id, &recipient),
            &gift.claim_key,
        ) {
            env::panic_str("invalid claim signature");
        }
        self.deliver(&gift, &recipient);
        let stored = self.gifts.gifts.get_mut(&gift_id).unwrap();
        stored.status = GiftStatus::Claimed;
        stored.recipient = Some(recipient.clone());
        stored.closed_ns = env::block_timestamp();
        emit(
            "gift_claimed",
            json!({ "gift_id": gift_id, "sender": gift.sender, "recipient": recipient }),
        );
    }

    /// After expiry the sender takes an unclaimed gift back. The fee stays paid.
    pub fn refund_gift(&mut self, gift_id: u64) {
        let gift = self.open_gift(gift_id);
        if env::predecessor_account_id() != gift.sender {
            env::panic_str("sender only");
        }
        if env::block_timestamp() < gift.expiry_ns {
            env::panic_str("gift not expired");
        }
        let sender = gift.sender.clone();
        self.deliver(&gift, &sender);
        let stored = self.gifts.gifts.get_mut(&gift_id).unwrap();
        stored.status = GiftStatus::Refunded;
        stored.closed_ns = env::block_timestamp();
        emit(
            "gift_refunded",
            json!({ "gift_id": gift_id, "sender": sender }),
        );
    }

    pub fn get_gift(&self, gift_id: u64) -> Option<Gift> {
        self.gifts.gifts.get(&gift_id).cloned()
    }

    pub fn get_gifts_sent(&self, account_id: AccountId) -> Vec<Gift> {
        self.gifts
            .gifts
            .values()
            .filter(|gift| gift.sender == account_id)
            .cloned()
            .collect()
    }

    pub fn get_gifts_received(&self, account_id: AccountId) -> Vec<Gift> {
        self.gifts
            .gifts
            .values()
            .filter(|gift| gift.recipient.as_ref() == Some(&account_id))
            .cloned()
            .collect()
    }
}
