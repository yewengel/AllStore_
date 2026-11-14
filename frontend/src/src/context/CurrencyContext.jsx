/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { currencyOptions, formatCurrency } from '../utils/currency';

const CurrencyContext = createContext(null);
const supportedCurrencies = currencyOptions.map(({ code }) => code);

const getInitialCurrency = () => {
  const savedCurrency = window.localStorage.getItem('allstore.currency');
  return supportedCurrencies.includes(savedCurrency) ? savedCurrency : 'USD';
};

export const CurrencyProvider = ({ children }) => {
  const [currency, setCurrencyState] = useState(getInitialCurrency);

  useEffect(() => {
    window.localStorage.setItem('allstore.currency', currency);
  }, [currency]);

  const setCurrency = useCallback((value) => {
    if (!supportedCurrencies.includes(value)) {
      throw new TypeError(`Unsupported currency preference: ${value}`);
    }
    setCurrencyState(value);
  }, []);

  const formatPrice = useCallback(
    (amount, sourceCurrency = 'USD') => formatCurrency(amount, sourceCurrency, currency),
    [currency]
  );
  const contextValue = useMemo(
    () => ({ currency, setCurrency, formatPrice }),
    [currency, setCurrency, formatPrice]
  );

  return <CurrencyContext.Provider value={contextValue}>{children}</CurrencyContext.Provider>;
};

export const useCurrency = () => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};
