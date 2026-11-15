import { Link } from 'react-router-dom';

const NotFoundPage = ({ title = 'Page Not Found', message = 'We could not find the page you were looking for.' }) => (
  <section className="allstore-not-found">
    <div className="allstore-not-found-mark" aria-hidden="true">404</div>
    <p className="store-eyebrow">ALLSTORE</p>
    <h1>{title}</h1>
    <p>{message}</p>
    <div className="allstore-not-found-actions">
      <Link to="/" className="btn-primary">Back to Home</Link>
      <Link to="/products" className="btn-secondary">Continue Shopping</Link>
    </div>
  </section>
);

export default NotFoundPage;
