import { useCallback, useEffect, useState } from 'react';
import api, { getProductImageUrl } from '../api/axios';
import { useCurrency } from '../context/CurrencyContext';

const NEXT_STATUSES = {
  'Return Requested': ['Under Review'],
  'Under Review': ['Approved', 'Rejected'],
  Approved: ['Return in Progress'],
  Rejected: [],
  'Return in Progress': ['Item Received'],
  'Item Received': ['Refund Processing', 'Return Completed'],
  'Refund Processing': ['Refunded', 'Return Completed'],
  Refunded: ['Return Completed'],
  'Return Completed': [],
};
const CONDITIONS = ['Unused', 'Like New', 'Damaged', 'Incomplete', 'Other'];
const formatDate = (value) => value
  ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  : '—';

const AdminReturns = ({ onToast, onViewOrder }) => {
  const { formatPrice } = useCurrency();
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState('');
  const [response, setResponse] = useState('');
  const [condition, setCondition] = useState('Like New');
  const [restockable, setRestockable] = useState(false);
  const [photos, setPhotos] = useState({});
  const [saving, setSaving] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get('/returns');
      setReturns(Array.isArray(data) ? data : []);
    } catch (error) {
      setLoadError(error.response?.data?.message || 'Return requests could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  useEffect(() => {
    let active = true;
    const urls = [];
    const loadPhotos = async () => {
      const entries = await Promise.all((selected?.photos || []).map(async (photo) => {
        try {
          const { data } = await api.get(photo.url, { responseType: 'blob' });
          const url = URL.createObjectURL(data);
          urls.push(url);
          return [photo.id, url];
        } catch {
          return [photo.id, ''];
        }
      }));
      if (active) setPhotos(Object.fromEntries(entries));
      else urls.forEach((url) => URL.revokeObjectURL(url));
    };
    void loadPhotos();
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selected]);

  const open = (request) => {
    setSelected(request);
    setStatus(request.status);
    setResponse(request.adminResponse || '');
    setCondition(request.receivedCondition || 'Like New');
    setRestockable(Boolean(request.restockable));
  };

  const save = async () => {
    if (!selected) return;
    if (status === 'Item Received' && !condition) {
      onToast?.('Choose the returned item condition.', 'error');
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.patch(`/returns/${selected.id}`, {
        status,
        response: response.trim(),
        ...(status === 'Item Received' ? { receivedCondition: condition, restockable } : {}),
      });
      setSelected(data);
      setStatus(data.status);
      setReturns((current) => current.map((item) => item.id === data.id ? data : item));
      onToast?.('Return status and customer message saved.');
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The return update could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const initiateRefund = async () => {
    if (!selected?.orderId) return;
    if (!window.confirm('Create a refund request for this inspected return? The money will not be sent by this action.')) return;
    setRefundBusy(true);
    try {
      await api.post('/admin/payments/refunds', {
        orderId: selected.orderId,
        returnRequestId: selected.id,
        reason: `Refund for return ${selected.orderNumber || ''}: ${selected.reason}`.slice(0, 500),
      });
      const { data } = await api.patch(`/returns/${selected.id}`, {
        status: 'Refund Processing',
        response: 'A refund request has been created and will be processed. The payment is not yet complete.',
      });
      setSelected(data);
      setStatus(data.status);
      setResponse(data.adminResponse);
      setReturns((current) => current.map((item) => item.id === data.id ? data : item));
      onToast?.('Linked refund request created; complete the payout from Refund Management.');
    } catch (error) {
      onToast?.(error.response?.data?.message || 'A refund request could not be created.', 'error');
      await load();
    } finally {
      setRefundBusy(false);
    }
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Return management <span className="admin-count">{returns.length}</span></h2>
          <p>Review customer requests, inspect received items, and manage return-linked refunds.</p>
        </div>
        <button type="button" className="admin-outline-button" onClick={load} disabled={loading}>Refresh</button>
      </div>

      {loading ? (
        <div className="admin-loading"><span className="admin-spinner" /><p>Loading return requests…</p></div>
      ) : loadError ? (
        <div className="admin-load-error" role="alert"><p>{loadError}</p><button type="button" className="admin-primary-button" onClick={load}>Try again</button></div>
      ) : !returns.length ? (
        <div className="admin-empty-state"><span className="admin-empty-mark">—</span><strong>No return requests</strong><p>Customer return requests will appear here.</p></div>
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead><tr><th>Order</th><th>Customer</th><th>Reason</th><th>Requested</th><th>Status</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {returns.map((request) => (
                <tr key={request.id}>
                  <td><strong>{request.orderNumber || 'Order'}</strong></td>
                  <td><strong>{request.customer?.name || 'Customer'}</strong><span className="admin-cell-subtitle">{request.customer?.email || request.customer?.phoneNumber || '—'}</span></td>
                  <td><span className="pay-address">{request.reason}</span></td>
                  <td>{formatDate(request.createdAt)}</td>
                  <td><span className="admin-status status-pending"><span className="admin-status-dot" />{request.status}</span></td>
                  <td><div className="admin-row-actions"><button type="button" className="admin-text-button" onClick={() => open(request)}>Review</button><button type="button" className="admin-text-button" onClick={() => onViewOrder(request.orderId)}>Open order</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="admin-modal admin-return-modal" role="dialog" aria-modal="true" aria-labelledby="return-modal-title">
            <div className="admin-modal-heading">
              <div><span className="admin-modal-eyebrow">RETURN {selected.orderNumber || ''}</span><h2 id="return-modal-title">Return request</h2></div>
              <button type="button" className="admin-icon-button" onClick={() => setSelected(null)} aria-label="Close">×</button>
            </div>
            <div className="admin-return-details">
              <div><span>Customer</span><strong>{selected.customer?.name || 'Customer'}</strong><small>{selected.customer?.email || '—'} · {selected.customer?.phoneNumber || '—'}</small></div>
              <div><span>Order total</span><strong>{formatPrice(selected.orderTotal || 0, selected.orderCurrency || 'ETB')}</strong></div>
              <div><span>Payment status</span><strong>{selected.paymentStatus || 'Unknown'}</strong></div>
              <div><span>Return reason</span><strong>{selected.reason}</strong></div>
              {selected.details && <div className="admin-return-full-width"><span>Customer details</span><p>{selected.details}</p></div>}
            </div>

            {selected.photos?.length > 0 && (
              <div className="admin-return-photos">
                <h3>Customer photos</h3>
                <div>{selected.photos.map((photo) => (
                  photos[photo.id]
                    ? <a key={photo.id} href={photos[photo.id]} target="_blank" rel="noreferrer"><img src={photos[photo.id]} alt={photo.originalName || 'Return item'} /></a>
                    : <span key={photo.id}>{photo.originalName || 'Photo unavailable'}</span>
                ))}</div>
              </div>
            )}

            <div className="admin-return-items">
              <h3>Items</h3>
              {selected.items?.map((item, index) => (
                <div key={`${item.name}-${index}`}><img src={getProductImageUrl(item.image)} alt="" /><span><strong>{item.name}</strong><small>Qty {item.qty}{item.variantSku ? ` · ${item.variantSku}` : ''}</small>{Object.entries(item.options || {}).map(([name, value]) => <small key={name}>{name}: {value}</small>)}</span></div>
              ))}
            </div>

            <label className="admin-status-control">Return status
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {[status, ...(NEXT_STATUSES[status] || [])].map((option) => <option key={option}>{option}</option>)}
              </select>
            </label>
            {status === 'Item Received' && (
              <div className="admin-return-inspection">
                <label className="admin-status-control">Received item condition
                  <select value={condition} onChange={(event) => setCondition(event.target.value)}>{CONDITIONS.map((option) => <option key={option}>{option}</option>)}</select>
                </label>
                <label className="admin-return-restock"><input type="checkbox" checked={restockable} onChange={(event) => setRestockable(event.target.checked)} /> Item was inspected and is eligible for resale; restore its quantity to stock</label>
                {selected.stockRestoredAt && <p>Stock restored on {formatDate(selected.stockRestoredAt)}. This action cannot be repeated.</p>}
              </div>
            )}
            <label className="admin-status-control">Message for customer
              <textarea rows="3" maxLength={1000} value={response} onChange={(event) => setResponse(event.target.value)} placeholder="Explain the decision, next step, or return status." />
            </label>
            <div className="admin-tracking-history">
              <h3>Return history</h3>
              {selected.history?.length ? <ol>{[...selected.history].reverse().map((entry, index) => <li key={`${entry.status}-${entry.timestamp || index}`}><strong>{entry.status}</strong><span>{entry.message || 'Status updated'}</span><time>{formatDate(entry.timestamp)}</time></li>)}</ol> : <p>No return updates recorded.</p>}
            </div>
            <div className="admin-modal-actions">
              {selected.status === 'Item Received' && ['Paid', 'Partially Refunded'].includes(selected.paymentStatus) && (
                <button type="button" className="admin-outline-button" onClick={initiateRefund} disabled={refundBusy}>{refundBusy ? 'Creating…' : 'Create linked refund'}</button>
              )}
              <button type="button" className="admin-outline-button" onClick={() => setSelected(null)}>Close</button>
              <button type="button" className="admin-primary-button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save update'}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

export default AdminReturns;
