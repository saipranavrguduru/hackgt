// U.S. product metadata, not ownership or payment credentials. Published reward
// highlights describe the product; rewardBps/categoryRewards contain ONLY rates
// supported by the context our comparison engine actually knows. Never turn a
// capped, activated, portal-only or payment-dependent highlight into a rule.
const highlight = (rate, label, detail = '') => ({ rate, label, detail });
export const CARD_PRODUCTS = [
  {
    id: 'discover-it', name: 'Discover it Cash Back', issuer: 'Discover', shortName: 'it Cash Back', network: 'Discover', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '5% in activated rotating categories; 1% on other purchases.',
    rewardHighlights: [highlight('5%', 'Rotating categories', 'Activation required; up to $1,500 combined spending each quarter, then 1%.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1%. We do not track quarterly activation or remaining bonus spending.',
    sourceUrl: 'https://www.discover.com/credit-cards/cash-back/cashback-bonus.html',
    additionalSourceUrls: ['https://www.discover.com/credit-cards/cash-back/it-card/'],
    limitations: 'Quarterly categories change. The 5% rate requires activation and available cap. First-year Cashback Match is excluded from purchase estimates.'
  },
  {
    id: 'active-cash', name: 'Wells Fargo Active Cash', issuer: 'Wells Fargo', shortName: 'Active Cash', network: 'Visa', annualFeeCents: 0, rewardBps: 200,
    rewardSummary: 'Unlimited 2% cash rewards on eligible purchases.',
    rewardHighlights: [highlight('2%', 'Eligible purchases', 'No rotating categories or category activation.')],
    sourceUrl: 'https://creditcards.wellsfargo.com/active-cash-credit-card/',
    limitations: 'Eligible purchases earn 2%. Cash advances, balance transfers, fees and other issuer exclusions do not earn purchase rewards. Posting and rounding can differ.'
  },
  {
    id: 'quicksilver', name: 'Capital One Quicksilver', issuer: 'Capital One', shortName: 'Quicksilver', network: 'Network varies', annualFeeCents: 0, rewardBps: 150,
    rewardSummary: '1.5% on purchases; 5% on eligible Capital One bookings.',
    rewardHighlights: [highlight('1.5%', 'Everyday purchases'), highlight('5%', 'Capital One Travel', 'Eligible hotels, vacation rentals, rental cars and activities booked through the portal.'), highlight('5%', 'Capital One Entertainment', 'Eligible purchases through the platform.')],
    comparisonNote: 'Comparisons use 1.5%; booking-channel eligibility is not verified.',
    sourceUrl: 'https://www.capitalone.com/learn-grow/money-management/ways-to-use-quicksilver-rewards/',
    additionalSourceUrls: ['https://www.capitalone.com/learn-grow/money-management/capital-one-quicksilver-vs-savor/', 'https://www.capitalone.com/learn-grow/money-management/is-capital-one-visa-or-mastercard/'],
    limitations: 'Portal bonuses apply only to eligible bookings through Capital One. Product networks vary by issued account; check your physical card. Targeted offers are excluded.'
  },
  {
    id: 'freedom-unlimited', name: 'Chase Freedom Unlimited', issuer: 'Chase', shortName: 'Freedom Unlimited', network: 'Visa', annualFeeCents: 0, rewardBps: 150, categoryRewards: { dining: 300, drugstores: 300 },
    rewardSummary: '3% dining and drugstores; 1.5% on other purchases.',
    rewardHighlights: [highlight('5%', 'Chase Travel', 'Travel purchased through Chase Travel only.'), highlight('3%', 'Dining & drugstores', 'Eligible dining includes takeout and delivery.'), highlight('1.5%', 'Other purchases')],
    sourceUrl: 'https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited', categorySourceUrl: 'https://www.chase.com/personal/credit-cards/rewards-category-faq',
    limitations: 'Merchant coding determines the dining and drugstore bonuses. Chase Travel and promotional bonuses are excluded from automatic comparisons.'
  },
  {
    id: 'savor', name: 'Capital One Savor', issuer: 'Capital One', shortName: 'Savor', network: 'Network varies', annualFeeCents: 0, rewardBps: 100, categoryRewards: { dining: 300, groceries: 300 },
    rewardSummary: '3% dining, groceries, entertainment and popular streaming.',
    rewardHighlights: [highlight('3%', 'Dining & grocery stores', 'Grocery stores exclude superstores such as Walmart and Target.'), highlight('3%', 'Entertainment & streaming', 'Eligible entertainment and popular streaming services.'), highlight('5%', 'Capital One Travel', 'Eligible hotels, vacation rentals, rental cars and activities booked through the portal.'), highlight('8%', 'Capital One Entertainment', 'Eligible purchases through the platform.'), highlight('1%', 'Other purchases')],
    sourceUrl: 'https://www.capitalone.com/learn-grow/money-management/everything-about-savor/',
    additionalSourceUrls: ['https://www.capitalone.com/learn-grow/money-management/is-capital-one-visa-or-mastercard/'],
    limitations: 'Comparisons support eligible dining and grocery categories; superstores do not qualify as grocery stores. Entertainment, streaming and portal bonuses require more specific context. This is the no-annual-fee Savor product; issued networks vary.'
  },
  {
    id: 'freedom-flex', name: 'Chase Freedom Flex', issuer: 'Chase', shortName: 'Freedom Flex', network: 'Mastercard', annualFeeCents: 0, rewardBps: 100, categoryRewards: { dining: 300, drugstores: 300 },
    rewardSummary: '5% activated quarterly categories; 3% dining and drugstores.',
    rewardHighlights: [highlight('5%', 'Rotating categories', 'Activate each quarter; up to $1,500 combined spending, then 1%.'), highlight('5%', 'Chase Travel', 'Travel purchased through Chase Travel only.'), highlight('3%', 'Dining & drugstores'), highlight('1%', 'Other purchases')],
    sourceUrl: 'https://www.chase.com/personal/credit-cards/freedom/flex', categorySourceUrl: 'https://www.chase.com/personal/credit-cards/rewards-category-faq',
    limitations: 'Comparisons include eligible dining and drugstores, but do not assume quarterly activation, remaining cap, portal booking or bonus stacking.'
  },
  {
    id: 'blue-cash-everyday', name: 'American Express Blue Cash Everyday', issuer: 'American Express', shortName: 'Blue Cash Everyday', network: 'American Express', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '3% at U.S. supermarkets, gas stations and online retailers, with caps.',
    rewardHighlights: [highlight('3%', 'U.S. supermarkets', 'Up to $6,000 per year, then 1%.'), highlight('3%', 'U.S. gas stations', 'Separate $6,000 annual spending cap, then 1%.'), highlight('3%', 'U.S. online retail', 'Separate $6,000 annual spending cap, then 1%.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1% until remaining annual category caps can be verified.',
    sourceUrl: 'https://www.americanexpress.com/us/credit-cards/card/blue-cash-everyday/',
    limitations: 'Each 3% category has its own annual spending cap. Superstores and warehouse clubs are not U.S. supermarkets. Online purchases must meet eligible retail rules. Rewards are redeemable Reward Dollars; enrollment credits are excluded.'
  },
  {
    id: 'blue-cash-preferred', name: 'American Express Blue Cash Preferred', issuer: 'American Express', shortName: 'Blue Cash Preferred', network: 'American Express', annualFeeCents: 9500, rewardBps: 100,
    rewardSummary: '6% U.S. supermarkets with a cap; 6% select streaming; 3% gas and transit.',
    rewardHighlights: [highlight('6%', 'U.S. supermarkets', 'Up to $6,000 per year, then 1%.'), highlight('6%', 'Select U.S. streaming', 'Only eligible subscription services.'), highlight('3%', 'U.S. gas & eligible transit', 'Transit includes eligible rideshare, parking, tolls, trains and buses.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1%; U.S. gas-station eligibility, the supermarket cap and specific streaming or transit eligibility are not verified.',
    sourceUrl: 'https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/',
    limitations: 'The standard annual fee is $95; an introductory waiver may apply. Supermarkets exclude superstores and warehouse clubs. Transit is not all travel. Reward Dollars and account credits follow issuer terms; fees are not deducted from purchase estimates.'
  },
  {
    id: 'citi-double-cash', name: 'Citi Double Cash', issuer: 'Citi', shortName: 'Double Cash', network: 'Mastercard', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '2% total: 1% when you buy, plus 1% as you pay.',
    rewardHighlights: [highlight('1% + 1%', 'Purchases & payments', 'The second 1% is earned as the purchase balance is paid.'), highlight('5%', 'Select Citi Travel bookings', 'Eligible hotels, car rentals and attractions; total includes the payment portion.')],
    comparisonNote: 'Comparisons count the 1% purchase portion only. The extra 1% depends on bill payment, which PerkPilot does not track.',
    sourceUrl: 'https://www.citi.com/credit-cards/citi-double-cash-credit-card',
    limitations: 'Rewards are ThankYou Points redeemable for cash. The additional payment reward requires a corresponding purchase balance and issuer payment terms. Portal bonuses are excluded from automatic estimates.'
  },
  {
    id: 'citi-custom-cash', name: 'Citi Custom Cash', issuer: 'Citi', shortName: 'Custom Cash', network: 'Mastercard', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '5% in your top eligible spending category, up to $500 per billing cycle.',
    rewardHighlights: [highlight('5%', 'Top eligible category', 'Only the highest-spend eligible category; first $500 each billing cycle, then 1%.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1%; your highest-spend category and remaining billing-cycle cap are unknown.',
    sourceUrl: 'https://www.citi.com/credit-cards/citi-custom-cash-credit-card',
    additionalSourceUrls: ['https://cardupgrade.citi.com/switchtociticustomcash/login.aspx', 'https://www.citi.com/credit-cards/citi-custom-cash-credit-card/additional-information'],
    limitations: 'For existing cardholders: new applications closed May 28, 2026. The top-category bonus has a $500 billing-cycle spending cap. Eligible categories and cash redemption follow issuer terms.'
  },
  {
    id: 'costco-anywhere', name: 'Costco Anywhere Visa by Citi', issuer: 'Citi', shortName: 'Costco Anywhere', network: 'Visa', annualFeeCents: 0, rewardBps: 100, categoryRewards: { dining: 300 },
    rewardSummary: '5% Costco gas / 4% other eligible gas with a shared cap; 3% dining and travel.',
    rewardHighlights: [highlight('5% / 4%', 'Costco gas / other gas & EV', 'Combined $7,000 annual spending cap, then 1%.'), highlight('3%', 'Restaurants & eligible travel'), highlight('2%', 'Costco & Costco.com'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons include eligible dining at 3%. Gas caps, specific retailers and travel eligibility are not verified.',
    sourceUrl: 'https://www.citi.com/credit-cards/costco-anywhere-visa-card',
    limitations: 'No annual card fee with a paid Costco membership. Gas/EV exclusions apply and share an annual cap. Rewards are issued as an annual certificate. Membership cost is not deducted from purchase estimates.'
  },
  {
    id: 'attune', name: 'Wells Fargo Attune', issuer: 'Wells Fargo', shortName: 'Attune', network: 'Mastercard', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '4% on eligible self-care, recreation and planet-friendly purchases.',
    rewardHighlights: [highlight('4%', 'Eligible lifestyle categories', 'Qualifying self-care, sports, recreation, entertainment and planet-friendly merchants.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1%; a broad category such as Other does not establish eligibility for the specific 4% merchant groups.',
    sourceUrl: 'https://www.wellsfargo.com/credit-cards/attune/terms/', categorySourceUrl: 'https://creditcards.wellsfargo.com/attune-cash-rewards-categories/',
    limitations: 'The 4% categories depend on eligible merchant codes, such as qualifying gyms, salons, transit and EV charging. They do not apply to every entertainment, travel or gas purchase. Promotional benefits are excluded.'
  },
  {
    id: 'bofa-customized-cash', name: 'Bank of America Customized Cash Rewards', issuer: 'Bank of America', shortName: 'Customized Cash', network: 'Visa', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '3% in a chosen category and 2% groceries / wholesale clubs, with a shared cap.',
    rewardHighlights: [highlight('3%', 'One chosen category', 'Choose an eligible category such as gas/EV, online shopping, dining, travel, drugstores or home improvement.'), highlight('2%', 'Groceries & wholesale clubs', 'Shares a $2,500 quarterly spending cap with the chosen category; then 1%.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1%; the chosen category, remaining shared cap and account reward tier are unknown.',
    sourceUrl: 'https://www.bankofamerica.com/credit-cards/products/cash-back-credit-card/cash-back-category-choices/',
    additionalSourceUrls: ['https://www.bankofamerica.com/credit-cards/cash-back-credit-cards/'],
    limitations: 'The 3% and 2% categories share a $2,500 quarterly spending cap, then earn 1%. Higher introductory selected-category rates are temporary. BofA Rewards account-tier boosts are not assumed.'
  },
  {
    id: 'bofa-unlimited-cash', name: 'Bank of America Unlimited Cash Rewards', issuer: 'Bank of America', shortName: 'Unlimited Cash', network: 'Visa', annualFeeCents: 0, rewardBps: 150,
    rewardSummary: 'Unlimited 1.5% cash back on eligible purchases.',
    rewardHighlights: [highlight('1.5%', 'Eligible purchases', 'Ongoing standard rate before any qualifying account-tier boost.')],
    sourceUrl: 'https://www.bankofamerica.com/credit-cards/',
    additionalSourceUrls: ['https://www.bankofamerica.com/bofa-rewards/increasing-bofa-rewards-with-credit-cards/'],
    limitations: 'Comparisons use the ongoing 1.5% rate. Higher rewards require a qualifying BofA Rewards tier; promotional first-year rates and account-tier bonuses are excluded.'
  },
  {
    id: 'us-bank-cash-plus', name: 'U.S. Bank Cash+ Visa Signature', issuer: 'U.S. Bank', shortName: 'Cash+', network: 'Visa', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '5% in two selected categories; 2% in one selected everyday category.',
    rewardHighlights: [highlight('5%', 'Two chosen categories', 'Activate quarterly; first $2,000 combined spending each quarter, then 1%.'), highlight('2%', 'One everyday category', 'Activate your choice of eligible groceries, restaurants, or gas/EV each quarter.'), highlight('5%', 'Eligible Travel Center bookings', 'Qualifying prepaid bookings through the U.S. Bank portal.'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons use 1%; selected categories, activation and remaining quarterly cap are not tracked.',
    sourceUrl: 'https://www.usbank.com/credit-cards/cash-plus-visa-signature-credit-card.html',
    limitations: 'Selection and activation are required each quarter for the chosen-category rates. The 5% chosen categories share a $2,000 spending cap. Portal-only and promotional rewards are excluded from estimates.'
  },
  {
    id: 'us-bank-smartly', name: 'U.S. Bank Smartly Visa Signature', issuer: 'U.S. Bank', shortName: 'Smartly', network: 'Visa', annualFeeCents: 0, rewardBps: 200,
    rewardSummary: 'Unlimited 2% base cash back; higher tiers require qualifying bank balances.',
    rewardHighlights: [highlight('2%', 'Eligible purchases', 'Standard rate without an account-balance boost.'), highlight('Up to 4%', 'Qualifying banking tiers', 'Requires Smartly Savings and eligible account balances; bonus applies to the first $10,000 in eligible purchases per billing cycle.')],
    comparisonNote: 'Comparisons use 2%. Qualifying deposit balances and bonus-tier eligibility are not verified.',
    sourceUrl: 'https://www.usbank.com/credit-cards/bank-smartly-visa-signature-credit-card.html',
    limitations: 'Higher 2.5%, 3% and 4% tiers require Smartly Savings plus qualifying checking/Safe Debit balances of $10,000, $50,000 and $100,000 respectively. Bonuses have a billing-cycle spending cap and exclusions. Cash values assume an eligible statement-credit or deposit redemption.'
  },
  {
    id: 'apple-card', name: 'Apple Card', issuer: 'Apple', shortName: 'Apple Card', network: 'Mastercard', annualFeeCents: 0, rewardBps: 100,
    rewardSummary: '2% with Apple Pay; 3% at Apple and eligible partners; 1% on other purchases.',
    rewardHighlights: [highlight('3%', 'Apple & eligible partners', 'Partner offers require Apple Pay and merchant-specific conditions.'), highlight('2%', 'Apple Pay purchases'), highlight('1%', 'Other card-number purchases', 'Ordinary stored-card or physical-card purchases outside higher-reward merchant offers.')],
    comparisonNote: 'Comparisons use 1%. A stored-card payment does not establish Apple Pay or partner eligibility.',
    sourceUrl: 'https://www.apple.com/apple-card/',
    limitations: 'Daily Cash depends on how you pay and the merchant. Partner-specific conditions apply to 3% rewards. PerkPilot test enrollment uses a stored card, not Apple Pay.'
  },
  {
    id: 'paypal-cashback', name: 'PayPal Cashback Mastercard', issuer: 'PayPal', shortName: 'Cashback Mastercard', network: 'Mastercard', annualFeeCents: 0, rewardBps: 150,
    rewardSummary: '3% through PayPal checkout; 1.5% on other eligible purchases.',
    rewardHighlights: [highlight('3%', 'PayPal checkout', 'Select this card as the payment method when checking out with PayPal.'), highlight('1.5%', 'Other eligible purchases')],
    comparisonNote: 'Comparisons use 1.5%. Direct stored-card checkout is not PayPal checkout.',
    sourceUrl: 'https://www.paypal.com/us/digital-wallet/manage-money/paypal-cashback-mastercard',
    limitations: 'An active PayPal account is required. The 3% rate applies only when checking out through PayPal with this card. Merchant and transaction exclusions follow issuer terms.'
  },
  {
    id: 'prime-visa', name: 'Chase Prime Visa', issuer: 'Chase', shortName: 'Prime Visa', network: 'Visa', annualFeeCents: 0, rewardBps: 100, categoryRewards: { dining: 200, gas: 200 },
    rewardSummary: '5% at eligible Amazon, Whole Foods and Chase Travel purchases with Prime.',
    rewardHighlights: [highlight('5%', 'Eligible Amazon & travel purchases', 'Amazon.com, Audible.com, Whole Foods Market and Chase Travel, with an eligible Prime membership.'), highlight('2%', 'Dining, gas & local transit'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons include eligible dining and gas at 2%; merchant, Prime and portal eligibility are not assumed.',
    sourceUrl: 'https://creditcards.chase.com/cash-back-credit-cards/amazon-prime-rewards',
    limitations: 'The card has no annual fee; Prime membership has a separate cost. The 5% rate requires eligible Prime membership and a qualifying merchant or portal. Generic grocery/travel categories and Amazon Pay purchases do not establish the 5% rate.'
  },
  {
    id: 'amazon-visa', name: 'Chase Amazon Visa', issuer: 'Chase', shortName: 'Amazon Visa', network: 'Visa', annualFeeCents: 0, rewardBps: 100, categoryRewards: { dining: 200, gas: 200 },
    rewardSummary: '3% at eligible Amazon, Whole Foods and Chase Travel purchases without Prime.',
    rewardHighlights: [highlight('3%', 'Eligible Amazon & travel purchases', 'Amazon.com, Audible.com, Whole Foods Market and Chase Travel.'), highlight('2%', 'Dining, gas & local transit'), highlight('1%', 'Other purchases')],
    comparisonNote: 'Comparisons include eligible dining and gas at 2%; specific retailers and booking portals are not verified.',
    sourceUrl: 'https://creditcards.chase.com/cash-back-credit-cards/amazon-rewards',
    limitations: 'No Prime membership is required for the standard 3% eligible-merchant rate. Amazon Pay and direct travel-provider bookings do not qualify for that bonus. Merchant coding determines other category rewards.'
  },
].map(product => ({ ...product, currency: 'USD', checkedAt: '2026-09-26', provenance: 'published_reward_rule', sourceLabel: 'Published reward rules · issuer sources checked September 26, 2026', version: 3 }));

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
    limitations: product ? [product.comparisonNote, product.limitations].filter(Boolean).join(' ') : 'No supported reward rule is available for this card.'
  };
}
