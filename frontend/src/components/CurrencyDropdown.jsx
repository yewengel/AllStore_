import { useRef } from 'react';
import { useCurrency } from '../context/CurrencyContext';
import { currencyOptions } from '../utils/currency';

const CurrencyDropdown = () => {
  const { currency, setCurrency } = useCurrency();
  const dropdownRef = useRef(null);
  const selectedOption = currencyOptions.find((option) => option.code === currency);

  return (
    <details className="store-currency-dropdown" ref={dropdownRef}>
      <summary className="store-currency-trigger" aria-label={`Currency: ${currency}`}>
        <span>{currency} / {selectedOption.symbol}</span>
        <svg className="store-currency-caret" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </summary>
      <div className="store-currency-panel" role="menu" aria-label="Select currency">
        <span className="store-currency-panel-title">Display currency</span>
        {currencyOptions.map((option) => (
          <button
            key={option.code}
            type="button"
            role="menuitemradio"
            aria-checked={currency === option.code}
            className={currency === option.code ? 'selected' : ''}
            onClick={() => {
              setCurrency(option.code);
              if (dropdownRef.current) dropdownRef.current.open = false;
            }}
          >
            <span>{option.code} / {option.symbol} — {option.label}</span>
            {currency === option.code && <span className="store-currency-check" aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </details>
  );
};

export default CurrencyDropdown;
