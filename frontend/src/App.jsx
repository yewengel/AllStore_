import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { WishlistProvider } from './context/WishlistContext';
import { CurrencyProvider } from './context/CurrencyContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';

// Page components
import HomePage from './pages/HomePage';
import ProductsPage from './pages/ProductsPage';
import ProductDetailsPage from './pages/ProductDetailsPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import MyOrders from './pages/MyOrders';
import OrderDetailsPage from './pages/OrderDetailsPage';
import OrderTrack from './pages/OrderTrack';
import PaymentResult from './pages/PaymentResult';
import LoginPage from './pages/LoginPage';
import CustomerPasswordResetPage from './pages/CustomerPasswordResetPage';
import RegisterPage from './pages/RegisterPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import AdminLoginPage from './pages/AdminLoginPage';
import AdminPasswordResetPage from './pages/AdminPasswordResetPage';
import WishlistPage from './pages/WishlistPage';
import NotFoundPage from './pages/NotFoundPage';
import CustomerRoute from './components/CustomerRoute';

import './App.css';

const AppLayout = () => {
  const { pathname } = useLocation();
  const isAdminLogin = pathname === '/secure-admin-login';
  const isAdminPasswordReset = [
    '/secure-admin-forgot-password',
    '/secure-admin-verify-code',
    '/secure-admin-reset-password',
  ].includes(pathname);
  const isAdminDashboard = pathname === '/admin' || pathname.startsWith('/secure-admin-dashboard');
  const isAdminPortal = isAdminLogin || isAdminPasswordReset || isAdminDashboard;

  useEffect(() => {
    document.title = isAdminLogin
      ? 'AllStore | Admin Login'
      : isAdminPasswordReset
        ? 'AllStore | Admin Password Reset'
        : isAdminDashboard
          ? 'AllStore | Admin Dashboard'
          : 'AllStore | Online Shopping';
  }, [isAdminDashboard, isAdminLogin, isAdminPasswordReset]);

  return (
    <div className={`app-container${isAdminPortal ? ' admin-portal-shell' : ''}`}>
      {!isAdminPortal && <Navbar />}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id" element={<ProductDetailsPage />} />
          <Route path="/wishlist" element={<ProtectedRoute><CustomerRoute><WishlistPage /></CustomerRoute></ProtectedRoute>} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/customer/forgot-password" element={<CustomerPasswordResetPage />} />
          <Route path="/customer/verify-password-reset" element={<CustomerPasswordResetPage />} />
          <Route path="/customer/reset-password" element={<CustomerPasswordResetPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/checkout"
            element={
              <ProtectedRoute>
                <CheckoutPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/my-orders"
            element={
              <ProtectedRoute>
                <MyOrders />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/track/:id"
            element={
              <ProtectedRoute>
                <OrderTrack />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <ProtectedRoute>
                <OrderDetailsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/payment/result/:id"
            element={
              <ProtectedRoute>
                <PaymentResult />
              </ProtectedRoute>
            }
          />
          <Route path="/orders" element={<Navigate to="/my-orders" replace />} />
          <Route path="/track-order" element={<Navigate to="/my-orders" replace />} />
          <Route path="/admin/orders" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />

          <Route path="/secure-admin-login" element={<AdminLoginPage />} />
          <Route path="/secure-admin-forgot-password" element={<AdminPasswordResetPage />} />
          <Route path="/secure-admin-verify-code" element={<AdminPasswordResetPage />} />
          <Route path="/secure-admin-reset-password" element={<AdminPasswordResetPage />} />
          <Route
            path="/secure-admin-dashboard/*"
            element={
              <AdminRoute>
                <AdminDashboardPage />
              </AdminRoute>
            }
          />
          <Route path="/admin" element={<Navigate to="/secure-admin-dashboard" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      {!isAdminPortal && <Footer />}
    </div>
  );
};

function App() {
  return (
    <Router>
      <CurrencyProvider>
        <AuthProvider>
          <WishlistProvider>
            <CartProvider>
              <AppLayout />
            </CartProvider>
          </WishlistProvider>
        </AuthProvider>
      </CurrencyProvider>
    </Router>
  );
}

export default App;
