import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError('Please provide both email and password');
      return;
    }

    try {
      setLoading(true);
      const data = await login(email, password);

      if (data.role === 'admin') {
        logout();
        setError('This account cannot sign in here.');
        return;
      }
      navigate(from === '/login' ? '/products' : from);
    } catch (err) {
      setError(
        err.response?.data?.message || 'Invalid email or password. Please verify your credentials.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFillDemo = () => {
    setEmail('customer@example.com');
    setPassword('customer123');
    setError(null);
  };

  return (
    <div className="auth-page">
      <div className="container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-icon-circle">🔐</div>
            <h1 className="auth-title">Welcome Back</h1>
            <p className="auth-subtitle">Sign in to your AllStore account</p>
          </div>

          {error && <div className="alert-error-banner">{error}</div>}

          <form onSubmit={handleSubmit} className="auth-form">
            <div className="form-group">
              <label htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                required
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-input"
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary btn-auth-submit">
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>

          {/* Quick Demo Credentials Box */}
          <div className="demo-credentials-box">
            <span className="demo-title">⚡ Quick Demo Logins:</span>
            <div className="demo-buttons-row">
              <button type="button" onClick={handleFillDemo} className="btn-demo-fill">
                👤 Customer Demo
              </button>
            </div>
            <p className="demo-hint">
              Clicking the button auto-populates the customer demo credentials.
            </p>
          </div>

          <div className="auth-footer-links">
            <p>
              Don't have an account?{' '}
              <Link to="/register" className="auth-link">
                Create Account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
