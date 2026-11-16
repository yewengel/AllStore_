import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import api from '../api/axios';

const EMAIL_STORAGE_KEY = 'allstore-admin-password-reset-email';

const AdminPasswordResetPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const isVerifyStep = location.pathname === '/secure-admin-verify-code';
  const isResetStep = location.pathname === '/secure-admin-reset-password';
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
    return <Navigate to="/secure-admin-forgot-password" replace />;
  }
  if (isResetStep && (!email || !location.state?.resetToken)) {
    return <Navigate to="/secure-admin-forgot-password" replace />;
  }

  const requestCode = async (event, resend = false) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const normalizedEmail = email.trim().toLowerCase();
    setSubmitting(true);
    try {
      const { data } = await api.post('/auth/admin/password-reset/request', { email: normalizedEmail });
      setEmail(normalizedEmail);
      sessionStorage.setItem(EMAIL_STORAGE_KEY, normalizedEmail);
      setSecondsLeft(60);
      if (resend) {
        setCode('');
        setMessage(data.message);
      } else {
        setMessage(data.message);
        navigate('/secure-admin-verify-code', {
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
      const { data } = await api.post('/auth/admin/password-reset/verify', { email, code });
      navigate('/secure-admin-reset-password', {
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
    if (password.length < 12) {
      setError('Use a password with at least 12 characters.');
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
      const { data } = await api.post('/auth/admin/password-reset/reset', {
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
    ? 'Your administrator password has been changed.'
    : isResetStep
      ? 'Create a new password for your AllStore administrator account.'
      : isVerifyStep
        ? `Enter the 6-digit code sent to ${email}.`
        : 'Enter your administrator email and we will send a verification code if it matches an admin account.';

  return (
    <main className="admin-login-page">
      <section className="admin-login-panel" aria-labelledby="admin-reset-title">
        <div className="admin-login-brand">
          <img src="/images/allstore-logo.png" alt="" />
          <span>
            <strong>AllStore</strong>
            <small>Shop Smart. Live Better.</small>
          </span>
        </div>

        <div className="admin-login-copy">
          <span className="admin-login-eyebrow">SECURE ADMINISTRATOR ACCESS</span>
          <h1 id="admin-reset-title">{title}</h1>
          <p>{description}</p>
        </div>

        {error && (
          <div className="admin-login-error" role="alert">
            <strong>Unable to continue</strong>
            <span>{error}</span>
          </div>
        )}
        {message && <p className="admin-reset-message" role="status">{message}</p>}

        {complete ? (
          <div className="admin-reset-success">
            <Link to="/secure-admin-login" className="admin-login-submit">Return to admin login</Link>
          </div>
        ) : isResetStep ? (
          <form className="admin-login-form" onSubmit={resetPassword}>
            <label htmlFor="admin-new-password">New password</label>
            <input
              id="admin-new-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <label htmlFor="admin-confirm-password">Confirm password</label>
            <input
              id="admin-confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={72}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
            <p className="admin-reset-hint">Use at least 12 characters. Passwords must match.</p>
            <button type="submit" className="admin-login-submit" disabled={submitting}>
              {submitting ? 'Updating password…' : 'Reset password'}
            </button>
          </form>
        ) : isVerifyStep ? (
          <>
            <form className="admin-login-form" onSubmit={verifyCode}>
              <label htmlFor="admin-reset-code">6-digit verification code</label>
              <input
                id="admin-reset-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
              <button type="submit" className="admin-login-submit" disabled={submitting}>
                {submitting ? 'Verifying code…' : 'Verify code'}
              </button>
            </form>
            <button
              type="button"
              className="admin-reset-resend"
              disabled={submitting || secondsLeft > 0}
              onClick={(event) => requestCode(event, true)}
            >
              {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend verification code'}
            </button>
          </>
        ) : (
          <form className="admin-login-form" onSubmit={requestCode}>
            <label htmlFor="admin-reset-email">Administrator email</label>
            <input
              id="admin-reset-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <button type="submit" className="admin-login-submit" disabled={submitting}>
              {submitting ? 'Sending code…' : 'Send verification code'}
            </button>
          </form>
        )}

        {!complete && (
          <div className="admin-login-footer">
            {isVerifyStep ? (
              <Link to="/secure-admin-forgot-password">Change email</Link>
            ) : (
              <span>Authorized administrators only</span>
            )}
            <Link to="/secure-admin-login">Back to admin login</Link>
          </div>
        )}
      </section>
      <aside className="admin-login-aside">
        <div className="admin-aside-content">
          <span className="admin-aside-kicker">ALLSTORE · OPERATIONS</span>
          <h2>Secure access to your store.</h2>
          <p>Reset your administrator password using a time-limited verification code.</p>
          <div className="admin-aside-status">
            <span className="admin-aside-status-dot" />
            Verification codes expire after 10 minutes
          </div>
        </div>
        <span className="admin-aside-watermark" aria-hidden="true">A</span>
      </aside>
    </main>
  );
};

export default AdminPasswordResetPage;
