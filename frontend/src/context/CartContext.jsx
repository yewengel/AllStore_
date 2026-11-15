/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import { getProductCurrency, toEtb } from '../utils/currency';

const CartContext = createContext();

const getCartItemKey = (item) => `${item.product}::${item.variantId || 'base'}`;

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState(() => {
    try {
      const stored = localStorage.getItem('cartItems');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Sync cart items to localStorage on modification
  useEffect(() => {
    try {
      localStorage.setItem('cartItems', JSON.stringify(cartItems));
    } catch (e) {
      console.error('Failed to save cart to localStorage', e);
    }
  }, [cartItems]);

  /**
   * Add a product to the shopping cart
   */
  const addToCart = (product, quantity = 1, selectedVariant = null) => {
    const qty = Number(quantity);
    const stockQuantity = Number(selectedVariant?.stockQuantity ?? product.stockQuantity);
    if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(stockQuantity) || stockQuantity < qty) {
      throw new RangeError('The selected product option does not have enough stock.');
    }

    const variantId = selectedVariant?._id ? String(selectedVariant._id) : '';
    const cartKey = `${product._id}::${variantId || 'base'}`;
    const variantData = {
      variantId,
      options: selectedVariant?.options || {},
      image: selectedVariant?.image || product.image,
      price: selectedVariant?.price ?? product.price,
      stockQuantity,
    };
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => getCartItemKey(item) === cartKey);

      if (existingItem) {
        const newQty = Math.min(existingItem.qty + qty, stockQuantity);
        return prevItems.map((item) =>
          getCartItemKey(item) === cartKey
            ? {
                ...item,
                name: product.name,
                ...variantData,
                currency: getProductCurrency(product),
                category: product.category,
                qty: newQty,
              }
            : item
        );
      } else {
        return [
          ...prevItems,
          {
            product: product._id,
            name: product.name,
            ...variantData,
            currency: getProductCurrency(product),
            category: product.category,
            qty,
          },
        ];
      }
    });
  };

  /**
   * Update quantity of a specific item
   */
  const updateQuantity = (productId, newQty) => {
    const qty = Number(newQty);
    if (qty <= 0) {
      removeFromCart(productId);
      return;
    }
    setCartItems((prevItems) =>
      prevItems.map((item) => {
        if (getCartItemKey(item) === productId) {
          const clampedQty = Math.min(qty, Number.isSafeInteger(item.stockQuantity) ? item.stockQuantity : 99);
          return { ...item, qty: clampedQty };
        }
        return item;
      })
    );
  };

  /**
   * Remove item from cart
   */
  const removeFromCart = (productId) => {
    setCartItems((prevItems) =>
      prevItems.filter((item) => getCartItemKey(item) !== productId)
    );
  };

  /**
   * Clear the cart
   */
  const clearCart = () => {
    setCartItems([]);
    localStorage.removeItem('cartItems');
  };

  // Cart summary calculations
  const totalItems = cartItems.reduce((acc, item) => acc + item.qty, 0);
  const totalPrice = cartItems.reduce(
    (acc, item) => acc + toEtb(item.price, item.currency) * item.qty,
    0
  );

  return (
    <CartContext.Provider
      value={{
        cartItems,
        totalItems,
        totalPrice: Number(totalPrice.toFixed(2)),
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
