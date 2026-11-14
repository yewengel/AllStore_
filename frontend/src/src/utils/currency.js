const DEFAULT_ETB_PER_USD = 164.62;
const getRate = (configuredRate, fallback, variableName) => {
  const rate = configuredRate === undefined || configuredRate.trim() === ''
    ? fallback
    : Number(configuredRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`${variableName} must be a positive finite number.`);
  }
  return rate;
};

const ETB_PER_USD = getRate(import.meta.env.VITE_ETB_PER_USD, DEFAULT_ETB_PER_USD, 'VITE_ETB_PER_USD');
const EUR_PER_USD = getRate(import.meta.env.VITE_EUR_PER_USD, 0.899865, 'VITE_EUR_PER_USD');
const GBP_PER_USD = getRate(import.meta.env.VITE_GBP_PER_USD, 0.752421, 'VITE_GBP_PER_USD');
const CHF_PER_USD = getRate(import.meta.env.VITE_CHF_PER_USD, 0.831838, 'VITE_CHF_PER_USD');
const CAD_PER_USD = getRate(import.meta.env.VITE_CAD_PER_USD, 1.423964, 'VITE_CAD_PER_USD');
const MXN_PER_USD = getRate(import.meta.env.VITE_MXN_PER_USD, 18.62736, 'VITE_MXN_PER_USD');

const currencyRates = {
  USD: 1,
  ETB: ETB_PER_USD,
  EUR: EUR_PER_USD,
  GBP: GBP_PER_USD,
  CHF: CHF_PER_USD,
  CAD: CAD_PER_USD,
  MXN: MXN_PER_USD,
};

const currencyPrefixes = {
  EUR: '€',
  GBP: '£',
  CHF: 'CHF ',
  CAD: 'CA$',
  MXN: '$MXN ',
};

export const currencyOptions = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'ETB', label: 'Ethiopian Birr', symbol: 'ETB' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'GBP', label: 'British Pound', symbol: '£' },
  { code: 'CHF', label: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'CA$' },
  { code: 'MXN', label: 'Mexican Peso', symbol: '$MXN' },
];

const etbFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const toUsd = (amount, currency) => {
  const sourceCurrency = resolveCurrency(currency);
  return amount / currencyRates[sourceCurrency];
};

export const resolveCurrency = (currency) => {
  if (currency === undefined || currency === null || currency === '') return 'USD';
  if (Object.hasOwn(currencyRates, currency)) return currency;
  throw new TypeError(`Unsupported currency: ${currency}`);
};

export const toEtb = (amount, currency) => {
  const value = Number(amount);
  if (!Number.isFinite(value)) throw new TypeError('Currency amount must be a finite number.');
  const sourceCurrency = resolveCurrency(currency);
  const etbAmount = sourceCurrency === 'ETB' ? value : toUsd(value, sourceCurrency) * ETB_PER_USD;
  return Math.round((etbAmount + Number.EPSILON) * 100) / 100;
};

export const formatDualCurrency = (amount, currency) => {
  if (amount === undefined || amount === null || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';

  const sourceCurrency = resolveCurrency(currency);
  const usdAmount = toUsd(value, sourceCurrency);
  const etbAmount = sourceCurrency === 'ETB' ? value : usdAmount * ETB_PER_USD;
  return `${etbFormatter.format(Math.round(etbAmount))} ETB / $${decimalFormatter.format(usdAmount)}`;
};

export const formatCurrency = (amount, sourceCurrency, displayCurrency = 'USD') => {
  if (amount === undefined || amount === null || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';

  const usdAmount = toUsd(value, sourceCurrency);
  switch (resolveCurrency(displayCurrency)) {
    case 'ETB':
      return `${etbFormatter.format(Math.round(usdAmount * ETB_PER_USD))} ETB`;
    case 'EUR':
    case 'GBP':
    case 'CHF':
    case 'CAD':
    case 'MXN': {
      return `${currencyPrefixes[displayCurrency]}${decimalFormatter.format(usdAmount * currencyRates[displayCurrency])}`;
    }
    default:
      return `$${decimalFormatter.format(usdAmount)}`;
  }
};

