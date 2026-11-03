#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExchangeError {
    ZeroSize,
    ZeroPrice,
    MarkNotSet,
    MarkDeviation,
    PostOnlyWouldCross,
    SelfTrade,
    BookTooDense,
    UnknownOrder,
    NotOrderOwner,
    InsufficientMargin,
    #[allow(dead_code)] // token withdraw uses this
    InsufficientCollateral,
    NotLiquidatable,
    UnknownMarket,
    MarkStale,
    InvalidMarket(&'static str),
    RecipientNotFlat,
    Overflow,
}

impl std::fmt::Display for ExchangeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ZeroSize => write!(f, "size is zero"),
            Self::ZeroPrice => write!(f, "price is zero"),
            Self::MarkNotSet => write!(f, "mark is not set"),
            Self::MarkDeviation => write!(f, "mark moved more than 25 percent"),
            Self::PostOnlyWouldCross => write!(f, "post-only order would cross"),
            Self::SelfTrade => write!(f, "self-trade"),
            Self::BookTooDense => write!(f, "book too dense"),
            Self::UnknownOrder => write!(f, "unknown order"),
            Self::NotOrderOwner => write!(f, "not the order owner"),
            Self::InsufficientMargin => write!(f, "insufficient margin"),
            Self::InsufficientCollateral => write!(f, "insufficient collateral"),
            Self::NotLiquidatable => write!(f, "not liquidatable"),
            Self::UnknownMarket => write!(f, "unknown market"),
            Self::MarkStale => write!(f, "mark is stale"),
            Self::InvalidMarket(reason) => write!(f, "invalid market: {reason}"),
            Self::RecipientNotFlat => write!(f, "recipient holds a position in this market"),
            Self::Overflow => write!(f, "overflow"),
        }
    }
}
