import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useCurrency } from '../context/CurrencyContext';
import {
  paymentMethodLabel,
  paymentStatusLabel,
  paymentStatusClass,
} from '../utils/payment';

const PAGE_SIZE = 10;
const STATUS_FILTERS = [
  'All statuses',
  'Paid',
  'Pending',
  'Pending Verification',
  'Failed',
  'Cancelled',
  'Rejected',
];

const formatDate = (value) => value
  ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  : '—';

const orderLabel = (record) => record.orderNumber || `#${String(record.orderId).slice(-8).toUpperCase()}`;

const PaymentHistory = () => {
  const { formatPrice } = useCurrency();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');
  const [page, setPage] = useState(1);

  const loadPayments = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await api.get('/payments/my-payments');
      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      setLoadError(error.response?.data?.message || 'Your payment history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadPayments);
  }, [loadPayments]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery = !query
        || String(record.transactionReference || '').toLowerCase().includes(query)
        || orderLabel(record).toLowerCase().includes(query)
        || String(record.orderId).toLowerCase().includes(query);
      const status = record.isPaid ? 'Paid' : record.paymentStatus || 'Pending';
      const matchesStatus = statusFilter === 'All statuses' || status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [records, search, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRecords = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="orders-page payment-history-page">
      <div className="container">
        <div className="page-header customer-orders-header">
          <div>
            <h1 className="page-title">Payment History</h1>
            <p className="page-description">Review every payment you have made on AllStore.</p>
          </div>
          <Link to="/my-orders" className="btn-secondary">My Orders</Link>
        </div>

        <section className="orders-toolbar" aria-label="Search and filter payments">
          <label className="orders-search-field">
            <span>Search by transaction ID or order</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="e.g. AS-PAY-… or AS-00125"
            />
          </label>
          <label className="orders-filter-field">
            <span>Payment status</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_FILTERS.map((status) => <option key={status}>{status}</option>)}
            </select>
          </label>
        </section>

        {loading ? (
          <div className="orders-state-card" role="status"><span className="spinner" /><p>Loading your payments…</p></div>
        ) : loadError ? (
          <div className="orders-state-card orders-error-state" role="alert">
            <h2>Payments unavailable</h2><p>{loadError}</p>
            <button type="button" className="btn-primary" onClick={loadPayments}>Try again</button>
          </div>
        ) : records.length === 0 ? (
          <div className="orders-state-card">
            <span className="orders-empty-icon" aria-hidden="true">💳</span>
            <h2>No payments yet</h2>
            <p>Your payment transactions will appear here after you place an order.</p>
            <Link to="/products" className="btn-primary">Explore products</Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="orders-state-card">
            <h2>No matching payments</h2><p>Try changing your search or status filter.</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setSearch(''); setStatusFilter('All statuses'); }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            <div className="payment-history-table-wrap">
              <table className="payment-history-table">
                <thead>
                  <tr>
                    <th>Transaction ID</th>
                    <th>Order</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRecords.map((record) => {
                    const statusLabel = paymentStatusLabel(record.paymentStatus, {
                      isPaid: record.isPaid,
                      paymentMethod: record.paymentMethod,
                    });
                    const statusClass = paymentStatusClass(record.paymentStatus, {
                      isPaid: record.isPaid,
                      paymentMethod: record.paymentMethod,
                    });
                    return (
                      <tr key={record.orderId}>
                        <td data-label="Transaction ID"><span className="payment-txn">{record.transactionReference || '—'}</span></td>
                        <td data-label="Order"><strong>{orderLabel(record)}</strong></td>
                        <td data-label="Method">{paymentMethodLabel(record.paymentMethod, record.paymentChannel)}</td>
                        <td data-label="Amount">
                          {formatPrice(record.paymentAmount ?? 0, record.paymentCurrency || 'ETB')}
                        </td>
                        <td data-label="Date">{formatDate(record.paymentDate || record.createdAt)}</td>
                        <td data-label="Status">
                          <span className={`payment-state ${statusClass}`}>{statusLabel}</span>
                        </td>
                        <td data-label="Actions">
                          <Link to={`/orders/${record.orderId}`} className="btn-secondary payment-history-view">
                            View Details
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <nav className="payment-history-pagination" aria-label="Payment history pages">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage === 1}
                >
                  Previous
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentHistory;
