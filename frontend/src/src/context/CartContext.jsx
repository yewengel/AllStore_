/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect } from 'react';
import { toEtb } from '../utils/currency';

const CartContext = createContext();

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
  const addToCart = (product, quantity = 1) => {
    const qty = Number(quantity);
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.product === product._id);

      if (existingItem) {
        // Calculate new quantity clamped to product's available stock
        const newQty = Math.min(
          existingItem.qty + qty,
          product.stockQuantity || 99
        );
        return prevItems.map((item) =>
          item.product === product._id
            ? {
                ...item,
                name: product.name,
                price: product.price,
                currency: product.currency || 'USD',
                image: product.image,
                stockQuantity: product.stockQuantity,
                category: product.category,
                qty: newQty,
              }
            : item
        );
      } else {
        const initialQty = Math.min(qty, product.stockQuantity || 99);
        return [
          ...prevItems,
          {
            product: product._id,
            name: product.name,
            price: product.price,
            currency: product.currency || 'USD',
            image: product.image,
            stockQuantity: product.stockQuantity,
            category: product.category,
            qty: initialQty,
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
        if (item.product === productId) {
          const clampedQty = Math.min(qty, item.stockQuantity || 99);
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
      prevItems.filter((item) => item.product !== productId)
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
