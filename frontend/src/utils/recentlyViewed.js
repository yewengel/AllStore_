const STORAGE_KEY = 'allstore-recently-viewed';

export const recordGuestRecentlyViewed = (productId) => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const ids = Array.isArray(stored) ? stored.map(String) : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify([
      String(productId),
      ...ids.filter((id) => id !== String(productId)),
    ].slice(0, 12)));
  } catch (error) {
    console.error('Could not store recently viewed product IDs:', error);
  }
};

export const getGuestRecentlyViewed = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.map(String).slice(0, 12) : [];
  } catch (error) {
    console.error('Could not read recently viewed product IDs:', error);
    return [];
  }
};
