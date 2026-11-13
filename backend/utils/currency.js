const configuredRate = process.env.ETB_PER_USD;
const ETB_PER_USD =
  configuredRate === undefined || configuredRate.trim() === ''
    ? 164.62
    : Number(configuredRate);

if (!Number.isFinite(ETB_PER_USD) || ETB_PER_USD <= 0) {
  throw new Error('ETB_PER_USD must be a positive finite number.');
}

const resolveCurrency = (currency) => {
  if (currency === undefined || currency === null || currency === '') return 'USD';
  if (currency === 'ETB' || currency === 'USD') return currency;
  throw new TypeError(`Unsupported currency: ${currency}`);
};

const roundCurrency = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;

const toEtb = (amount, currency) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new TypeError('Currency amount must be a finite number.');
  return roundCurrency(resolveCurrency(currency) === 'ETB' ? value : value * ETB_PER_USD);
};

const toEtbMongoExpression = (amountExpression, currencyExpression) => ({
  $cond: [
    { $eq: [currencyExpression, 'ETB'] },
    amountExpression,
    { $multiply: [amountExpression, ETB_PER_USD] },
  ],
});

module.exports = { ETB_PER_USD, resolveCurrency, roundCurrency, toEtb, toEtbMongoExpression };
