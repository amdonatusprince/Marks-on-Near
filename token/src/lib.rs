//! NEP-141 collateral used by Marks on testnet.
//!
//! Mint is limited to the account that deployed the token. Transfers, storage
//! deposits, and `ft_transfer_call` are the standard. Marks credits a trader
//! only when this token calls `ft_on_transfer`.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    token: FungibleToken,
    owner: AccountId,
    metadata: FungibleTokenMetadata,
}

#[near]
impl Token {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Marks USD".to_string(),
            symbol: "USDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(b"a".to_vec()),
            owner: owner_id,
            metadata,
        }
    }

    /// Register the account if needed, then mint. Only the owner can call this.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        if env::predecessor_account_id() != self.owner {
            env::panic_str("owner only");
        }
        if amount.0 == 0 {
            env::panic_str("size is zero");
        }
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint {
            owner_id: account_id.as_ref(),
            amount,
            memo: None,
        }
        .emit();
    }
}

#[near]
impl FungibleTokenCore for Token {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Token {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Token {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Token {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, NearToken};

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn as_owner() {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(account("owner.testnet"))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
    }

    fn token() -> Token {
        as_owner();
        Token::new(account("owner.testnet"))
    }

    #[test]
    fn mint_credits_only_the_owner() {
        let amount = 5_000_000u128;
        let mut token = token();
        token.mint(account("alice.testnet"), U128(amount));
        assert_eq!(token.ft_balance_of(account("alice.testnet")), U128(amount));
        assert_eq!(token.ft_total_supply(), U128(amount));
        assert_eq!(token.ft_metadata().decimals, 6);
    }

    #[test]
    #[should_panic(expected = "owner only")]
    fn a_stranger_cannot_mint() {
        let mut token = token();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(account("alice.testnet"))
            .build());
        token.mint(account("alice.testnet"), U128(1));
    }

    #[test]
    fn ft_transfer_moves_the_balance() {
        let amount = 5_000_000u128;
        let sent = 2_000_000u128;
        let mut token = token();
        token.mint(account("alice.testnet"), U128(amount));
        token.mint(account("bob.testnet"), U128(1));
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(account("alice.testnet"))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        token.ft_transfer(account("bob.testnet"), U128(sent), None);
        assert_eq!(
            token.ft_balance_of(account("alice.testnet")),
            U128(amount - sent)
        );
        assert_eq!(token.ft_balance_of(account("bob.testnet")), U128(1 + sent));
    }

    #[test]
    fn storage_deposit_registers_an_account() {
        let mut token = token();
        let bounds = token.storage_balance_bounds();
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(account("alice.testnet"))
            .attached_deposit(bounds.min)
            .build());
        let balance = token.storage_deposit(Some(account("carol.testnet")), Some(true));
        assert_eq!(balance.total, bounds.min);
        assert!(token.storage_balance_of(account("carol.testnet")).is_some());
    }

    #[test]
    fn ft_transfer_call_moves_tokens_to_the_receiver() {
        let amount = 5_000_000u128;
        let mut token = token();
        token.mint(account("alice.testnet"), U128(amount));
        token.mint(account("marks.testnet"), U128(1));
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(account("alice.testnet"))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        let _transferred =
            token.ft_transfer_call(account("marks.testnet"), U128(amount), None, String::new());
        assert_eq!(token.ft_balance_of(account("alice.testnet")), U128(0));
        assert_eq!(
            token.ft_balance_of(account("marks.testnet")),
            U128(1 + amount)
        );
    }
}
