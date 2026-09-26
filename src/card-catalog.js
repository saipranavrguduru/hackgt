// Product metadata only. Ownership, account identifiers and linked offers are separate fixtures.
export const CARD_PRODUCTS = [
  { id: 'discover-it', name: 'Discover it Cash Back', network: 'Discover', rewardBps: 100, sourceUrl: 'https://www.discover.com/credit-cards/cash-back/cashback-bonus.html', limitations: 'Base 1% only. Activated 5% rotating categories, caps and promotional matching are excluded.' },
  { id: 'active-cash', name: 'Wells Fargo Active Cash', network: 'Visa', rewardBps: 200, sourceUrl: 'https://www.wellsfargo.com/credit-cards/documents/active-cash-terms/', limitations: 'Base 2% only. Issuer exclusions and posting or rounding differences may apply.' },
  { id: 'quicksilver', name: 'Capital One Quicksilver', network: 'Mastercard', rewardBps: 150, sourceUrl: 'https://www.capitalone.com/learn-grow/money-management/ways-to-use-quicksilver-rewards/', limitations: 'Base 1.5% only. Travel and entertainment bonuses are excluded.' },
  { id: 'freedom-unlimited', name: 'Chase Freedom Unlimited', network: 'Visa', rewardBps: 150, categoryRewards: { dining: 300, drugstores: 300 }, sourceUrl: 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited', categorySourceUrl: 'https://www.chase.com/personal/credit-cards/rewards-category-faq', limitations: '3% on eligible dining and drugstore purchases; 1.5% on other eligible purchases. Merchant coding determines bonuses. Chase Travel and promotional bonuses are excluded.' },
].map(product => ({ ...product, currency: 'USD', checkedAt: '2026-09-26', provenance: 'published_reward_rule', sourceLabel: 'Published reward rules · issuer sources checked September 26, 2026', version: 2 }));

export const cardProducts = CARD_PRODUCTS;
export function getCardProduct(id) { return CARD_PRODUCTS.find(product => product.id === id); }

// Canonical product rules only: client rates and stale copied wallet metadata cannot override these.
export function getRewardRule(card, { category = null } = {}) {
  const product = getCardProduct(card.productId);
  const baseRewardBps = product?.rewardBps ?? 0;
  const bonus = Object.hasOwn(product?.categoryRewards || {}, category) ? product.categoryRewards[category] : null;
  return {
    rewardBps: bonus > baseRewardBps ? bonus : baseRewardBps,
    baseRewardBps, basis: bonus > baseRewardBps ? 'category' : 'base', category, estimated: true,
    sourceUrl: product?.sourceUrl || null, categorySourceUrl: product?.categorySourceUrl || null,
    checkedAt: product?.checkedAt || null,
    limitations: product?.limitations || 'No supported reward rule is available for this card.'
  };
}
