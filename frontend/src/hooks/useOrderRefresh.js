import { useEffect, useRef } from 'react';

const ORDER_REFRESH_INTERVAL_MS = 10_000;

const useOrderRefresh = (refresh) => {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    let refreshing = false;

    const refreshVisibleOrder = async () => {
      if (refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        await refreshRef.current();
      } finally {
        refreshing = false;
      }
    };

    const interval = window.setInterval(() => {
      void refreshVisibleOrder();
    }, ORDER_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refreshVisibleOrder);
    document.addEventListener('visibilitychange', refreshVisibleOrder);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshVisibleOrder);
      document.removeEventListener('visibilitychange', refreshVisibleOrder);
    };
  }, []);
};

export default useOrderRefresh;
