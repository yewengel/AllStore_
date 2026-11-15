import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CustomerRoute = ({ children }) => {
  const { isCustomer } = useAuth();
  return isCustomer ? children : <Navigate to="/" replace />;
};

export default CustomerRoute;
