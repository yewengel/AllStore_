import { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';

const AdminReviews = ({ onToast }) => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState('');
  const [notes, setNotes] = useState({});

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/admin/reviews');
      setReviews(Array.isArray(data) ? data : []);
    } catch (requestError) {
      console.error('Failed to load pending reviews:', requestError);
      setError(requestError.response?.data?.message || 'Pending reviews could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(loadReviews, 0);
    return () => window.clearTimeout(timer);
  }, [loadReviews]);

  const moderate = async (review, status) => {
    setSavingId(String(review._id));
    try {
      await api.patch(`/admin/reviews/${review._id}`, {
        status,
        moderationNote: notes[review._id] || '',
      });
      setReviews((current) => current.filter((entry) => entry._id !== review._id));
      onToast(`Review ${status.toLowerCase()}.`);
    } catch (requestError) {
      console.error('Failed to moderate review:', requestError);
      onToast(requestError.response?.data?.message || 'Review moderation failed.', 'error');
    } finally {
      setSavingId('');
    }
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div><h2>Review moderation</h2><p>Only approved reviews appear on product pages.</p></div>
        <button type="button" className="admin-link-button" onClick={loadReviews}>Refresh</button>
      </div>
      {error && <p className="alert-error-banner" role="alert">{error}</p>}
      {loading ? <p role="status">Loading pending reviews…</p> : reviews.length ? (
        <div className="admin-review-list">
          {reviews.map((review) => (
            <article className="admin-review-card" key={review._id}>
              <div className="admin-review-meta">
                <strong>{review.product?.name || 'Product'}</strong>
                <span>{review.user?.name || review.user?.email || 'Customer'} · Order {review.order?.orderNumber || '—'}</span>
                <span className="review-stars" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
              </div>
              <p>{review.body}</p>
              <label>
                Moderation note (optional)
                <input
                  maxLength="500"
                  value={notes[review._id] || ''}
                  onChange={(event) => setNotes((current) => ({ ...current, [review._id]: event.target.value }))}
                />
              </label>
              <div className="admin-review-actions">
                <button type="button" disabled={savingId === String(review._id)} onClick={() => moderate(review, 'Approved')}>Approve</button>
                <button type="button" disabled={savingId === String(review._id)} onClick={() => moderate(review, 'Rejected')}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="admin-empty-state"><strong>No pending reviews</strong><p>New customer reviews will appear here for moderation.</p></div>
      )}
    </section>
  );
};

export default AdminReviews;
