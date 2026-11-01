//! Price conversion for the Outlayer oracle callback.
//!
//! A dollar price is `multiplier / 10^decimals`. Marks stores that price in
//! ticks of the market's tick size, with six decimals of quote precision.

#[near_sdk::near(serializers = [json])]
#[derive(Clone)]
pub struct OraclePrice {
    pub multiplier: String,
    pub decimals: u32,
}

#[near_sdk::near(serializers = [json])]
#[derive(Clone)]
pub struct OracleRecord {
    pub asset_id: String,
    pub price: Option<OraclePrice>,
}

#[near_sdk::near(serializers = [json])]
#[derive(Clone)]
pub struct CustomDataResult {
    pub id: String,
    #[serde(default)]
    pub value: Option<near_sdk::serde_json::Value>,
    #[serde(default)]
    pub timestamp: Option<u64>,
    #[serde(default)]
    pub error: Option<String>,
}

#[near_sdk::near(serializers = [json])]
#[derive(Clone)]
pub struct PriceData {
    pub timestamp: String,
    pub recency_duration_sec: u32,
    pub prices: Vec<OracleRecord>,
}

pub fn ticks_from_price(multiplier: &str, decimals: u32, tick_size: u128) -> Option<u64> {
    let multiplier: u128 = multiplier.parse().ok()?;
    if tick_size == 0 {
        return None;
    }
    let quote_atoms = if decimals >= 6 {
        multiplier.checked_div(10u128.checked_pow(decimals - 6)?)?
    } else {
        multiplier.checked_mul(10u128.checked_pow(6 - decimals)?)?
    };
    u64::try_from(quote_atoms / tick_size).ok()
}

/// A dollar amount written as `190.25` becomes quote atoms, then ticks.
pub fn ticks_from_decimal(raw: &str, tick_size: u128) -> Option<u64> {
    let raw = raw.trim();
    if raw.is_empty() || tick_size == 0 {
        return None;
    }
    let (whole, frac) = raw.split_once('.').unwrap_or((raw, ""));
    let whole: u128 = whole.parse().ok()?;
    let mut digits: String = frac
        .chars()
        .filter(|c| c.is_ascii_digit())
        .take(6)
        .collect();
    while digits.len() < 6 {
        digits.push('0');
    }
    let fraction: u128 = digits.parse().ok()?;
    let quote = whole.checked_mul(1_000_000)?.checked_add(fraction)?;
    u64::try_from(quote / tick_size)
        .ok()
        .filter(|ticks| *ticks > 0)
}

#[cfg(test)]
mod tests {
    use super::{ticks_from_decimal, ticks_from_price};

    #[test]
    fn five_dollars_at_a_one_dollar_tick_is_five_ticks() {
        let multiplier = "5000000";
        let decimals = 6;
        let tick_size = 1_000_000u128;
        assert_eq!(ticks_from_price(multiplier, decimals, tick_size), Some(5));
    }

    #[test]
    fn a_dollar_and_cents_price_lands_on_the_tick() {
        let tick_size = 1_000_000u128;
        assert_eq!(ticks_from_decimal("190.25", tick_size), Some(190));
    }
}
