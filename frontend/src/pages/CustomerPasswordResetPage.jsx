import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api from '../api/axios';

const EMAIL_STORAGE_KEY = 'allstore-customer-password-reset-email';

const CustomerPasswordResetPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isVerifyStep = location.pathname === '/customer/verify-password-reset';
  const isResetStep = location.pathname === '/customer/reset-password';
  const [email, setEmail] = useState(
    () => location.state?.email || sessionStorage.getItem(EMAIL_STORAGE_KEY) || ''
  );
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(location.state?.resendAfter || 0);
  const [message, setMessage] = useState(location.state?.notice || '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = window.setTimeout(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  if (isVerifyStep && !email) {
    return <Navigate to="/customer/forgot-password" replace />;
  }
  if (isResetStep && (!email || !location.state?.resetToken)) {
    return <Navigate to="/customer/forgot-password" replace />;
  }

  const requestCode = async (event, resend = false) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/customer/password-reset/request', {
        email: normalizedEmail,
      });
      setEmail(normalizedEmail);
      sessionStorage.setItem(EMAIL_STORAGE_KEY, normalizedEmail);
      setSecondsLeft(60);
      if (resend) {
        setCode('');
        setMessage(data.message);
      } else {
        setMessage(data.message);
        navigate('/customer/verify-password-reset', {
          state: { email: normalizedEmail, notice: data.message, resendAfter: 60 },
        });
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'The request could not be completed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/customer/password-reset/verify', { email, code });
      navigate('/customer/reset-password', {
        state: { email, resetToken: data.resetToken },
      });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'The verification code is invalid or expired.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password.length < 6) {
      setError('Use a password with at least 6 characters.');
      return;
    }
    if (new TextEncoder().encode(password).length > 72) {
      setError('The password must not exceed 72 UTF-8 bytes.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/customer/password-reset/reset', {
        email,
        resetToken: location.state.resetToken,
        newPassword: password,
      });
      setComplete(true);
      setMessage(data.message);
      sessionStorage.removeItem(EMAIL_STORAGE_KEY);
      setPassword('');
      setConfirmPassword('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'The password could not be reset. Request a new code and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = complete
    ? 'Password updated'
    : isResetStep
      ? 'Choose a new password'
      : isVerifyStep
        ? 'Check your email'
        : 'Forgot your password?';
  const description = complete
    ? 'Your password has been changed. You can now sign in.'
    : isResetStep
      ? 'Create a new password for your AllStore customer account.'
      : isVerifyStep
        ? `Enter the 6-digit code sent to ${email}.`
        : 'Enter your email address. If it belongs to a customer account, we will send a verification code.';

  return (
    <div className="auth-page">
      <div className="container">
        <section className="auth-card" aria-labelledby="customer-reset-title">
          <div className="auth-header">
            <div className="auth-icon-circle" aria-hidden="true">🔐</div>
            <h1 id="customer-reset-title" className="auth-title">{title}</h1>
            <p className="auth-subtitle">{description}</p>
          </div>

          {error && <div className="alert-error-banner" role="alert">{error}</div>}
          {message && <p className="customer-reset-message" role="status">{message}</p>}

          {complete ? (
            <div className="customer-reset-success">
              <Link to="/login" className="btn-primary btn-auth-submit">
                Back to Sign In
              </Link>
            </div>
          ) : isResetStep ? (
            <form className="auth-form" onSubmit={resetPassword}>
              <div className="form-group">
                <label htmlFor="customer-new-password">New Password</label>
                <input
                  id="customer-new-password"
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="customer-confirm-password">Confirm Password</label>
                <input
                  id="customer-confirm-password"
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn-primary btn-auth-submit" disabled={submitting}>
                {submitting ? 'Updating Password...' : 'Reset Password'}
              </button>
            </form>
          ) : isVerifyStep ? (
            <>
              <form className="auth-form" onSubmit={verifyCode}>
                <div className="form-group">
                  <label htmlFor="customer-reset-code">6-Digit Verification Code</label>
                  <input
                    id="customer-reset-code"
                    className="form-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                </div>
                <button type="submit" className="btn-primary btn-auth-submit" disabled={submitting}>
                  {submitting ? 'Verifying Code...' : 'Verify Code'}
                </button>
              </form>
              <button
                type="button"
                className="customer-reset-resend"
                disabled={submitting || secondsLeft > 0}
                onClick={(event) => requestCode(event, true)}
              >
                {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend Verification Code'}
              </button>
            </>
          ) : (
            <form className="auth-form" onSubmit={requestCode}>
              <div className="form-group">
                <label htmlFor="customer-reset-email">Email Address</label>
                <input
                  id="customer-reset-email"
                  className="form-input"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </div>
              <button type="submit" className="btn-primary btn-auth-submit" disabled={submitting}>
                {submitting ? 'Sending Code...' : 'Send Verification Code'}
              </button>
            </form>
          )}

          {!complete && (
            <div className="auth-footer-links">
              {isVerifyStep && (
                <Link to="/customer/forgot-password" className="auth-link">
                  Change Email
                </Link>
              )}
              {' '}
              <Link to="/login" className="auth-link">Back to Sign In</Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default CustomerPasswordResetPage;
