import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const AdminRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="admin-access-state">
        <div className="spinner" />
        <p>Verifying administrator access...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/secure-admin-login" replace />;
  }

  if (user.role !== 'admin') {
    return (
      <section className="admin-access-denied">
        <div className="admin-access-denied-card">
          <span className="admin-login-eyebrow">403 · ACCESS DENIED</span>
          <h1>Administrator access required</h1>
          <p>This account does not have permission to open the management dashboard.</p>
          <Link to="/" className="admin-login-submit">
            Return to AllStore
          </Link>
        </div>
      </section>
    );
  }

  return children;
};

export default AdminRoute;
