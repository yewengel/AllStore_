import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';

const WishlistButton = ({ productId }) => {
  const { user } = useAuth();
  const { isSaved, toggleProduct } = useWishlist();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saved = isSaved(productId);
  if (user?.role === 'admin') return null;

  const handleClick = async () => {
    if (user?.role !== 'customer') {
      navigate('/login');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await toggleProduct(productId);
    } catch (requestError) {
      console.error('Failed to update wishlist:', requestError);
      setError(requestError.response?.data?.message || 'Wishlist could not be updated.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="wishlist-button-wrap">
      <button
        type="button"
        className={`wishlist-button${saved ? ' saved' : ''}`}
        onClick={handleClick}
        disabled={saving}
        aria-label={saved ? 'Remove from wishlist' : 'Add to wishlist'}
        aria-pressed={saved}
        title={saved ? 'Remove from wishlist' : 'Add to wishlist'}
      >
        {saved ? '♥' : '♡'}
      </button>
      {error && <span className="wishlist-button-error" role="alert">{error}</span>}
    </span>
  );
};

export default WishlistButton;
