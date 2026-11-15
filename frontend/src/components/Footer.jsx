import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="footer">
      <div className="container">
        <div className="store-footer-content">
          <div className="store-footer-about">
            <Link to="/" className="store-footer-brand">
              <img src="/images/allstore-logo.png" alt="AllStore — Shop Smart. Live Better." />
            </Link>
            <p className="store-footer-tagline">Shop Smart. Live Better.</p>
            <p>
              AllStore brings together useful finds for your home, style, and everyday life.
              Browse with ease and shop with confidence.
            </p>
          </div>

          <div className="store-footer-links">
            <div>
              <h2>Explore</h2>
              <Link to="/products">All products</Link>
              <Link to="/cart">Shopping cart</Link>
            </div>
            <div>
              <h2>Customer service</h2>
              <Link to="/my-orders">My orders</Link>
              <Link to="/login">Sign in</Link>
            </div>
          </div>
        </div>
        <div className="store-footer-bottom">
          <span>© {new Date().getFullYear()} AllStore. All rights reserved.</span>
          <span>Shop Smart. Live Better.</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
