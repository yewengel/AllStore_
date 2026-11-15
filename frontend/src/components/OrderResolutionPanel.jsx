import { useEffect, useState } from 'react';
import api from '../api/axios';
import { useCurrency } from '../context/CurrencyContext';

const formatDate = (value) => value
  ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  : '—';

const OrderResolutionPanel = ({ order, onOrderUpdated, compact = false }) => {
  const { formatPrice } = useCurrency();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const returnRequest = order.returnRequest;
  const [photoUrls, setPhotoUrls] = useState({});
  const refunds = order.refunds || [];
  const isDelivering = ['Shipped', 'Out for Delivery'].includes(order.orderStatus);

  useEffect(() => {
    if (compact) return undefined;
    let active = true;
    const urls = [];
    const loadPhotos = async () => {
      const entries = await Promise.all((returnRequest?.photos || []).map(async (photo) => {
        try {
          const { data } = await api.get(photo.url, { responseType: 'blob' });
          const url = URL.createObjectURL(data);
          urls.push(url);
          return [photo.id, url];
        } catch {
          return [photo.id, ''];
        }
      }));
      if (active) setPhotoUrls(Object.fromEntries(entries));
      else urls.forEach((url) => URL.revokeObjectURL(url));
    };
    void loadPhotos();
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [compact, returnRequest]);

  const submitReturn = async (event) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError('Enter a reason for your return request.');
      return;
    }
    const body = new FormData();
    body.append('orderId', order._id);
    body.append('reason', reason.trim());
    body.append('details', details.trim());
    photos.forEach((photo) => body.append('photos', photo));
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.post('/returns', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const { data } = await api.get(`/orders/${order._id}`);
      onOrderUpdated?.(data);
      setReason('');
      setDetails('');
      setPhotos([]);
      setMessage('Your return request was submitted for review.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Your return request could not be submitted.');
    } finally {
      setBusy(false);
    }
  };

  if (compact) {
    const latestRefund = refunds[0];
    return (
      <div className="order-resolution-summary">
        {latestRefund && (
          <div>
            <strong>Refund: {latestRefund.status}</strong>
            <span>Refund {formatPrice(latestRefund.amount, latestRefund.currency)} of {formatPrice(latestRefund.originalAmount, latestRefund.currency)} paid · {latestRefund.paymentMethod || order.paymentMethod}</span>
            {latestRefund.providerRefundReference && <span>Refund reference: {latestRefund.providerRefundReference}</span>}
            {latestRefund.customerMessage && <p>{latestRefund.customerMessage}</p>}
            <small>Updated {formatDate(latestRefund.updatedAt || latestRefund.processedAt || latestRefund.requestedAt)}</small>
            {latestRefund.history?.map((entry, index) => (
              <small key={`${entry.status}-${entry.timestamp || index}`}>{entry.status} · {formatDate(entry.timestamp)}{entry.message ? ` — ${entry.message}` : ''}</small>
            ))}
          </div>
        )}
        {returnRequest && (
          <div>
            <strong>Return: {returnRequest.status}</strong>
            <span>{returnRequest.reason}</span>
            {returnRequest.adminResponse && <p>Message from AllStore: {returnRequest.adminResponse}</p>}
            <small>Updated {formatDate(returnRequest.updatedAt || returnRequest.createdAt)}</small>
            {returnRequest.history?.map((entry, index) => (
              <small key={`${entry.status}-${entry.timestamp || index}`}>{entry.status} · {formatDate(entry.timestamp)}{entry.message ? ` — ${entry.message}` : ''}</small>
            ))}
          </div>
        )}
        {order.orderStatus === 'Cancelled' && order.cancellationReason && (
          <div><strong>Cancellation reason</strong><span>{order.cancellationReason}</span><small>{formatDate(order.cancelledAt)}</small></div>
        )}
        {!latestRefund && order.orderStatus === 'Cancelled' && !order.isPaid && (
          <div><strong>Refund: Not Required</strong><span>No payment was received for this order.</span></div>
        )}
      </div>
    );
  }

  return (
    <section className="order-detail-panel order-resolution-panel" id="returns">
      <div className="order-detail-section-heading"><h2>Cancellation, refunds &amp; returns</h2></div>

      {order.orderStatus === 'Cancelled' && (
        <div className="order-resolution-block">
          <strong>Cancellation reason</strong>
          <p>{order.cancellationReason || 'No cancellation reason was recorded.'}</p>
          <time>{formatDate(order.cancelledAt)}</time>
        </div>
      )}

      <div className="order-resolution-block">
        <h3>Refunds</h3>
        {refunds.length ? refunds.map((refund) => (
          <article className="order-resolution-entry" key={refund.id}>
            <div className="order-resolution-entry-heading">
              <strong>{refund.status}</strong>
              <time>{formatDate(refund.updatedAt || refund.processedAt || refund.requestedAt)}</time>
            </div>
            <p>{formatPrice(refund.amount, refund.currency)} · {refund.paymentMethod || order.paymentMethod}</p>
            {refund.providerRefundReference && <p>Refund reference: {refund.providerRefundReference}</p>}
            {refund.customerMessage
              ? <div className="order-resolution-message"><strong>Message from AllStore</strong><p>{refund.customerMessage}</p></div>
              : <p className="order-resolution-muted">No refund message has been added.</p>}
            {refund.history?.length > 0 && (
              <ol className="order-resolution-history">
                {refund.history.map((entry, index) => (
                  <li key={`${entry.status}-${entry.timestamp || index}`}>
                    <strong>{entry.status}</strong><span>{entry.message || 'Status updated'}</span><time>{formatDate(entry.timestamp)}</time>
                  </li>
                ))}
              </ol>
            )}
          </article>
        )) : order.orderStatus === 'Cancelled' && !order.isPaid ? (
          <p className="order-resolution-muted">No refund is required because no payment was received.</p>
        ) : <p className="order-resolution-muted">There are no refund updates for this order.</p>}
      </div>

      <div className="order-resolution-block">
        <h3>Returns</h3>
        {returnRequest ? (
          <article className="order-resolution-entry">
            <div className="order-resolution-entry-heading">
              <strong>{returnRequest.status}</strong>
              <time>{formatDate(returnRequest.updatedAt || returnRequest.createdAt)}</time>
            </div>
            <p><strong>Reason:</strong> {returnRequest.reason}</p>
            {returnRequest.details && <p>{returnRequest.details}</p>}
            {returnRequest.adminResponse
              ? <div className="order-resolution-message"><strong>Message from AllStore</strong><p>{returnRequest.adminResponse}</p></div>
              : <p className="order-resolution-muted">The Admin has not added a response yet.</p>}
            {returnRequest.photos?.length > 0 && (
              <div className="order-resolution-photo-list">
                {returnRequest.photos.map((photo) => (
                  photoUrls[photo.id]
                    ? <a key={photo.id} href={photoUrls[photo.id]} target="_blank" rel="noreferrer">{photo.originalName || 'Return photo'}</a>
                    : <span key={photo.id}>{photo.originalName || 'Return photo'} (unavailable)</span>
                ))}
              </div>
            )}
            {returnRequest.history?.length > 0 && (
              <ol className="order-resolution-history">
                {returnRequest.history.map((entry, index) => (
                  <li key={`${entry.status}-${entry.timestamp || index}`}>
                    <strong>{entry.status}</strong><span>{entry.message || 'Status updated'}</span><time>{formatDate(entry.timestamp)}</time>
                  </li>
                ))}
              </ol>
            )}
          </article>
        ) : order.orderStatus === 'Delivered' ? (
          <form className="order-return-form" onSubmit={submitReturn}>
            <p>Tell us why you would like to return this order. Your request will be reviewed by the store.</p>
            <label>
              Return reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required rows={3} />
            </label>
            <label>
              Additional details (optional)
              <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={2000} rows={3} />
            </label>
            <label>
              Product photos (optional, up to 5)
              <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={(event) => setPhotos(Array.from(event.target.files || []).slice(0, 5))} />
            </label>
            {photos.length > 0 && <span className="order-resolution-muted">{photos.length} photo{photos.length === 1 ? '' : 's'} selected</span>}
            {error && <p className="orders-feedback error" role="alert">{error}</p>}
            {message && <p className="orders-feedback success" role="status">{message}</p>}
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Request Return'}</button>
          </form>
        ) : isDelivering ? (
          <div className="order-resolution-message">
            <strong>Your order is already on its way</strong>
            <p>It cannot be cancelled directly while in transit. Contact the store if you have a delivery problem or special request.</p>
            <a href={`mailto:${import.meta.env.VITE_SUPPORT_EMAIL || 'support@allstore.com'}?subject=${encodeURIComponent(`Delivery help for ${order.orderNumber || order._id}`)}`}>Contact Admin</a>
          </div>
        ) : <p className="order-resolution-muted">Return requests are available after an order is delivered.</p>}
      </div>
      {error && returnRequest && <p className="orders-feedback error" role="alert">{error}</p>}
    </section>
  );
};

export default OrderResolutionPanel;
