import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminLoginPage = () => {
  const { user, loading: sessionLoading, loginAdmin } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!sessionLoading && user?.role === 'admin') {
    return <Navigate to="/secure-admin-dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await loginAdmin(email.trim(), password);
      navigate('/secure-admin-dashboard', { replace: true });
    } catch (loginError) {
      setError(
        loginError.code === 'ADMIN_ACCESS_DENIED'
          ? 'Access denied. This account does not have administrator privileges.'
          : loginError.response?.data?.message || 'Unable to sign in. Check your credentials and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="admin-login-page">
      <section className="admin-login-panel" aria-labelledby="admin-login-title">
        <div className="admin-login-brand">
          <img src="/images/allstore-logo.png" alt="" />
          <span>
            <strong>AllStore</strong>
            <small>Shop Smart. Live Better.</small>
          </span>
        </div>

        <div className="admin-login-copy">
          <span className="admin-login-eyebrow">PRIVATE ADMINISTRATION PORTAL</span>
          <h1 id="admin-login-title">Welcome back</h1>
          <p>Sign in with your administrator account to manage store operations.</p>
        </div>

        {error && (
          <div className="admin-login-error" role="alert">
            <strong>Sign-in unsuccessful</strong>
            <span>{error}</span>
          </div>
        )}

        <form className="admin-login-form" onSubmit={handleSubmit}>
          <label htmlFor="admin-email">Administrator email</label>
          <input
            id="admin-email"
            type="email"
            autoComplete="username"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <div className="admin-password-label">
            <label htmlFor="admin-password">Password</label>
            <span>Protected sign-in</span>
          </div>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          <button type="submit" className="admin-login-submit" disabled={submitting || sessionLoading}>
            {submitting ? 'Verifying access...' : 'Sign in to dashboard'}
          </button>
        </form>

        <div className="admin-login-footer">
          <span>Authorized administrators only</span>
          <Link to="/">Return to storefront</Link>
        </div>
      </section>
      <aside className="admin-login-aside">
        <div className="admin-aside-content">
          <span className="admin-aside-kicker">ALLSTORE · OPERATIONS</span>
          <h2>Shop smart. Run your store better.</h2>
          <p>Manage catalog, inventory, and customer orders from a secure workspace.</p>
          <div className="admin-aside-status">
            <span className="admin-aside-status-dot" />
            Secure administrator access
          </div>
        </div>
        <span className="admin-aside-watermark" aria-hidden="true">A</span>
      </aside>
    </main>
  );
};

export default AdminLoginPage;
