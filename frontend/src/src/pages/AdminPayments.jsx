import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '../api/axios';
import './AdminPayments.css';

const PAYMENT_METHODS = ['Telebirr', 'M-Pesa', 'Bank Transfer', 'Visa', 'Mastercard', 'Cash on Delivery'];
const PAYMENT_STATUSES = [
  'Pending',
  'Processing',
  'Paid',
  'Failed',
  'Cancelled',
  'Awaiting Verification',
  'Unpaid',
  'Refunded',
  'Partially Refunded',
  'Rejected',
];
const REFUND_STATUSES = ['Requested', 'Approved', 'Rejected', 'Processing', 'Refunded', 'Failed'];
const ONLINE_METHODS = ['Telebirr', 'M-Pesa', 'Visa', 'Mastercard'];

const METHOD_TONES = {
  Telebirr: 'telebirr',
  'M-Pesa': 'mpesa',
  'Bank Transfer': 'bank',
  Visa: 'visa',
  Mastercard: 'mastercard',
  'Cash on Delivery': 'cod',
};

const etbFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = (value) => `${etbFormatter.format(Number(value) || 0)} ETB`;
const compact = (value) => {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1000) return `${(amount / 1000).toFixed(1)}k`;
  return `${Math.round(amount)}`;
};

const formatDate = (date) =>
  date ? new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const formatDateTime = (date) =>
  date
    ? new Date(date).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '—';
const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const StatusPill = ({ status }) => (
  <span className={`pay-status pay-status-${slug(status)}`}>
    <span className="pay-status-dot" />
    {status || 'Unknown'}
  </span>
);

const MethodPill = ({ method }) => (
  <span className={`pay-method pay-method-${METHOD_TONES[method] || 'other'}`}>{method}</span>
);

const EmptyState = ({ title, detail }) => (
  <div className="pay-empty">
    <strong>{title}</strong>
    <p>{detail}</p>
  </div>
);

const Loader = ({ label = 'Loading payment data…' }) => (
  <div className="admin-loading">
    <span className="admin-spinner" />
    <p>{label}</p>
  </div>
);

const Pager = ({ page, pages, total, onChange }) => {
  if (!total) return null;
  return (
    <div className="pay-pagination">
      <span>
        Page {page} of {pages} · {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="pay-pagination-actions">
        <button type="button" className="admin-outline-button" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button type="button" className="admin-outline-button" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, note, tone }) => (
  <article className={`pay-stat-card pay-stat-${tone}`}>
    <span className="pay-stat-accent" />
    <span className="pay-stat-label">{label}</span>
    <strong className="pay-stat-value">{value}</strong>
    <span className="pay-stat-note">{note}</span>
  </article>
);

const useReceiptOpener = (onToast) =>
  useCallback(
    async (id) => {
      try {
        const response = await api.get(`/admin/payments/bank-transfers/${id}/receipt`, { responseType: 'blob' });
        const url = URL.createObjectURL(response.data);
        window.open(url, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch (error) {
        onToast?.(error.response?.status === 404 ? 'No receipt was uploaded for this transfer.' : 'Receipt could not be opened.', 'error');
      }
    },
    [onToast]
  );

// ---------------------------------------------------------------------------
// Payment Overview
// ---------------------------------------------------------------------------

const PERIOD_TABS = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['yearly', 'Yearly'],
];

const PaymentOverview = ({ onToast, onView }) => {
  const [period, setPeriod] = useState('monthly');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/payments/stats', { params: { period } });
      setStats(data);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Payment statistics could not be loaded.', 'error');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [period, onToast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading && !stats) return <Loader />;

  const cards = stats?.cards || {};
  const trend = stats?.trend || [];
  const methodStats = stats?.methodStats || PAYMENT_METHODS.map((method) => ({ method, count: 0, amount: 0 }));
  const maxMethod = Math.max(1, ...methodStats.map((entry) => entry.amount));

  return (
    <>
      <section className="pay-stat-grid" aria-label="Payment statistics">
        <StatCard label="Total revenue" value={money(cards.totalRevenue)} note="Successfully collected payments" tone="revenue" />
        <StatCard label="Successful payments" value={cards.successfulPayments ?? 0} note="Paid, non-cancelled orders" tone="success" />
        <StatCard label="Pending payments" value={cards.pendingPayments ?? 0} note="Awaiting completion or verification" tone="pending" />
        <StatCard label="Failed payments" value={cards.failedPayments ?? 0} note="Declined or failed attempts" tone="failed" />
        <StatCard label="Refunded amount" value={money(cards.refundedAmount)} note="Total refunded to customers" tone="refund" />
        <StatCard label="COD awaiting collection" value={money(cards.codAwaitingCollection)} note="Cash on delivery still to collect" tone="cod" />
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading analytics-heading">
          <div>
            <h2>Revenue analytics</h2>
            <p>Collected revenue and payment volume over time</p>
          </div>
          <div className="admin-period-tabs" aria-label="Analytics period">
            {PERIOD_TABS.map(([key, label]) => (
              <button type="button" key={key} className={period === key ? 'selected' : ''} onClick={() => setPeriod(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="admin-chart-grid">
          <div className="admin-chart">
            <div className="admin-chart-title">
              <strong>Revenue</strong>
              <span>ETB</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="payRevenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--deep-plum)" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="var(--deep-plum)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#eee7df" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} minTickGap={16} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} tickFormatter={compact} width={44} />
                <Tooltip formatter={(value) => money(value)} contentStyle={{ borderRadius: 9, border: '1px solid #e7ded4', boxShadow: '0 8px 24px rgb(53 33 59 / 0.08)' }} />
                <Area type="monotone" dataKey="revenue" stroke="var(--deep-plum)" strokeWidth={2.5} fill="url(#payRevenueFill)" activeDot={{ r: 4, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="admin-chart">
            <div className="admin-chart-title">
              <strong>Payments</strong>
              <span>Count</span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eee7df" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} minTickGap={16} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} width={32} />
                <Tooltip formatter={(value) => [value, 'Payments']} contentStyle={{ borderRadius: 9, border: '1px solid #e7ded4', boxShadow: '0 8px 24px rgb(53 33 59 / 0.08)' }} />
                <Bar dataKey="count" fill="var(--muted-coral)" radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Payment method statistics</h2>
            <p>Collected volume and payment count by method</p>
          </div>
        </div>
        <div className="pay-method-grid">
          {methodStats.map((entry) => (
            <div className="pay-method-card" key={entry.method}>
              <div className="pay-method-card-head">
                <MethodPill method={entry.method} />
                <strong>{money(entry.amount)}</strong>
              </div>
              <div className="pay-method-bar">
                <span style={{ width: `${Math.round((entry.amount / maxMethod) * 100)}%` }} />
              </div>
              <span className="pay-method-count">{entry.count} payment{entry.count === 1 ? '' : 's'}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Recent transactions</h2>
            <p>The latest payment activity across your store</p>
          </div>
        </div>
        <TransactionsTable rows={stats?.recentTransactions || []} onView={onView} />
      </section>
    </>
  );
};

// ---------------------------------------------------------------------------
// Shared transactions table
// ---------------------------------------------------------------------------

const TransactionsTable = ({ rows, onView }) => {
  if (!rows.length) return <EmptyState title="No transactions found" detail="Payment records will appear here." />;
  return (
    <div className="admin-table-scroll">
      <table className="admin-data-table pay-table">
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Order</th>
            <th>Customer</th>
            <th>Method</th>
            <th>Provider</th>
            <th>Amount</th>
            <th>Date</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td><span className="pay-ref">{row.transactionReference || `#${String(row.id).slice(-8).toUpperCase()}`}</span></td>
              <td><span className="admin-order-id">{row.orderNumber || '—'}</span></td>
              <td>
                <strong>{row.customerName}</strong>
                <span className="admin-cell-subtitle">{row.customerEmail || '—'}</span>
              </td>
              <td><MethodPill method={row.methodLabel} /></td>
              <td>{row.paymentProvider}</td>
              <td><strong>{money(row.amount)}</strong></td>
              <td>{formatDate(row.paymentDate || row.createdAt)}</td>
              <td><StatusPill status={row.paymentStatus} /></td>
              <td>
                <button type="button" className="admin-text-button" onClick={() => onView(row.id)}>
                  View details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ---------------------------------------------------------------------------
// All Transactions
// ---------------------------------------------------------------------------

const TransactionsPage = ({ onToast, onView }) => {
  const [filters, setFilters] = useState({ search: '', method: 'All methods', status: 'All statuses', from: '', to: '', sort: 'newest' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page,
        limit: 10,
        sort: filters.sort,
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
        ...(filters.method !== 'All methods' ? { method: filters.method } : {}),
        ...(filters.status !== 'All statuses' ? { status: filters.status } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
      };
      const response = await api.get('/admin/payments/transactions', { params });
      setData(response.data);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Transactions could not be loaded.', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, page, onToast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const update = (field, value) => {
    setPage(1);
    setFilters((current) => ({ ...current, [field]: value }));
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>All transactions <span className="admin-count">{data.total}</span></h2>
          <p>Search, filter and review every payment record</p>
        </div>
      </div>

      <div className="pay-filters">
        <input
          className="pay-input pay-search-input"
          type="search"
          placeholder="Search transaction ID, order number, name or email…"
          value={filters.search}
          onChange={(event) => update('search', event.target.value)}
        />
        <select className="admin-filter-select" value={filters.method} onChange={(event) => update('method', event.target.value)}>
          {['All methods', ...PAYMENT_METHODS].map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        <select className="admin-filter-select" value={filters.status} onChange={(event) => update('status', event.target.value)}>
          {['All statuses', ...PAYMENT_STATUSES].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
        <label className="pay-date-field">
          <span>From</span>
          <input className="pay-input" type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} />
        </label>
        <label className="pay-date-field">
          <span>To</span>
          <input className="pay-input" type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} />
        </label>
        <select className="admin-filter-select" value={filters.sort} onChange={(event) => update('sort', event.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {loading ? <Loader label="Loading transactions…" /> : <TransactionsTable rows={data.items} onView={onView} />}
      <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />
    </section>
  );
};

// ---------------------------------------------------------------------------
// Transaction details
// ---------------------------------------------------------------------------

const TransactionDetailsModal = ({ id, onClose, onToast }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const openReceipt = useReceiptOpener(onToast);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get(`/admin/payments/transactions/${id}`)
      .then((response) => {
        if (active) setDetail(response.data);
      })
      .catch((error) => {
        if (active) onToast?.(error.response?.data?.message || 'Transaction details could not be loaded.', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, onToast]);

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="admin-modal pay-detail-modal" role="dialog" aria-modal="true" aria-labelledby="pay-detail-title">
        <div className="admin-modal-heading">
          <div>
            <span className="admin-modal-eyebrow">
              {detail?.transaction?.transactionReference || 'TRANSACTION'}
            </span>
            <h2 id="pay-detail-title">Transaction details</h2>
          </div>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading || !detail ? (
          <Loader label="Loading transaction…" />
        ) : (
          <div className="pay-detail-body">
            <div className="pay-detail-grid">
              <DetailBlock title="Transaction information">
                <DetailRow label="Transaction ID" value={detail.transaction.transactionReference || String(detail.transaction.id)} />
                <DetailRow label="Order number" value={detail.transaction.orderNumber || '—'} />
                <DetailRow label="Payment method" value={<MethodPill method={detail.transaction.methodLabel} />} />
                <DetailRow label="Payment provider" value={detail.transaction.paymentProvider} />
                <DetailRow label="Amount" value={money(detail.transaction.amount)} />
                <DetailRow label="Currency" value={detail.transaction.currency} />
                <DetailRow label="Transaction date" value={formatDateTime(detail.transaction.paymentDate || detail.transaction.createdAt)} />
                <DetailRow label="Payment status" value={<StatusPill status={detail.transaction.paymentStatus} />} />
              </DetailBlock>

              <DetailBlock title="Customer information">
                <DetailRow label="Customer name" value={detail.customer.name} />
                <DetailRow label="Email" value={detail.customer.email || '—'} />
                <DetailRow label="Phone number" value={detail.customer.phone || '—'} />
              </DetailBlock>
            </div>

            <DetailBlock title="Order information">
              <div className="pay-order-items">
                {detail.order.items.map((item, index) => (
                  <div className="pay-order-item" key={`${item.name}-${index}`}>
                    <span className="pay-order-item-name">{item.name}</span>
                    <span className="pay-order-item-qty">× {item.qty}</span>
                    <strong>{money(item.price * item.qty)}</strong>
                  </div>
                ))}
                {!detail.order.items.length && <span className="pay-muted">No order items recorded.</span>}
              </div>
              <div className="pay-totals">
                <DetailRow label="Subtotal" value={money(detail.order.subtotal)} />
                <DetailRow label="Delivery fee" value={money(detail.order.shippingCost)} />
                <DetailRow label="Discount" value={`− ${money(detail.order.discountAmount)}`} />
                <DetailRow label="Final total" value={<strong>{money(detail.order.totalPrice)}</strong>} />
              </div>
              <DetailRow label="Delivery address" value={detail.order.deliveryAddress || '—'} />
            </DetailBlock>

            <DetailBlock title="Verification information">
              <DetailRow label="Provider reference" value={detail.verification.providerReference || '—'} />
              <DetailRow label="Gateway verification" value={detail.verification.gatewayResult} />
              <DetailRow
                label="Bank receipt"
                value={
                  detail.verification.receipt ? (
                    <button type="button" className="admin-text-button" onClick={() => openReceipt(detail.transaction.id)}>
                      View uploaded receipt
                    </button>
                  ) : (
                    '—'
                  )
                }
              />
              <DetailRow label="Verification date" value={formatDateTime(detail.verification.verifiedAt)} />
              <DetailRow
                label="Reviewed by"
                value={
                  detail.verification.reviewedBy
                    ? `${detail.verification.reviewedBy.name || 'Administrator'} · ${formatDateTime(detail.verification.reviewedAt)}`
                    : '—'
                }
              />
              {detail.verification.reviewNote && <DetailRow label="Review note" value={detail.verification.reviewNote} />}
              {detail.transaction.paymentMethod === 'Cash on Delivery' && (
                <>
                  <DetailRow label="Collection status" value={detail.verification.cod.status} />
                  <DetailRow label="Collected amount" value={detail.verification.cod.collectedAmount != null ? money(detail.verification.cod.collectedAmount) : '—'} />
                  <DetailRow label="Collected at" value={formatDateTime(detail.verification.cod.collectedAt)} />
                </>
              )}
            </DetailBlock>

            <DetailBlock title="Payment history">
              {detail.history?.length ? (
                <ol className="pay-timeline">
                  {detail.history.map((entry, index) => (
                    <li key={`${entry.status}-${entry.timestamp || index}`}>
                      <div className="pay-timeline-head">
                        <StatusPill status={entry.status} />
                        <time>{formatDateTime(entry.timestamp)}</time>
                      </div>
                      {entry.message && <p>{entry.message}</p>}
                      {entry.previousStatus && <span className="pay-muted">Previous status: {entry.previousStatus}</span>}
                      {entry.adminNote && <span className="pay-muted">Admin note: {entry.adminNote}</span>}
                      {entry.adminUserId?.name && <span className="pay-muted">Administrator: {entry.adminUserId.name}</span>}
                    </li>
                  ))}
                </ol>
              ) : (
                <span className="pay-muted">No payment status changes recorded yet.</span>
              )}
            </DetailBlock>
          </div>
        )}
      </section>
    </div>
  );
};

const DetailBlock = ({ title, children }) => (
  <div className="pay-detail-block">
    <h3>{title}</h3>
    <div className="pay-detail-rows">{children}</div>
  </div>
);

const DetailRow = ({ label, value }) => (
  <div className="pay-detail-row">
    <span>{label}</span>
    <div>{value}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Bank transfer verification
// ---------------------------------------------------------------------------

const BankTransfersPage = ({ onToast, onView }) => {
  const [status, setStatus] = useState('awaiting');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const openReceipt = useReceiptOpener(onToast);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/payments/bank-transfers', { params: { status } });
      setRows(data);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Bank transfers could not be loaded.', 'error');
    } finally {
      setLoading(false);
    }
  }, [status, onToast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const review = async (row, decision, note) => {
    setBusyId(row.id);
    try {
      await api.patch(`/admin/payments/bank-transfers/${row.id}/review`, { decision, note });
      onToast?.(decision === 'approve' ? 'Bank transfer verified and marked as paid.' : 'Bank transfer rejected.');
      await load();
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The transfer could not be updated.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const approve = (row) => {
    if (!window.confirm(`Confirm that the bank transfer for ${row.orderNumber} has cleared your account and mark it as paid?`)) return;
    review(row, 'approve', 'Verified against the bank statement.');
  };

  const reject = (row) => {
    const note = window.prompt(`Enter the reason for rejecting the bank transfer for ${row.orderNumber}. This will be shown to the customer.`);
    if (note === null) return;
    if (!note.trim()) {
      onToast?.('A rejection reason is required.', 'error');
      return;
    }
    review(row, 'reject', note.trim());
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Bank transfer verification</h2>
          <p>Manually verify transfers against your bank account before marking them paid</p>
        </div>
        <select className="admin-filter-select" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="awaiting">Awaiting verification</option>
          <option value="reviewed">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {loading ? (
        <Loader label="Loading bank transfers…" />
      ) : !rows.length ? (
        <EmptyState title="No bank transfers here" detail="Transfers awaiting verification will be listed here." />
      ) : (
        <div className="pay-card-list">
          {rows.map((row) => (
            <article className="pay-transfer-card" key={row.id}>
              <div className="pay-transfer-main">
                <div className="pay-transfer-head">
                  <span className="admin-order-id">{row.orderNumber}</span>
                  <StatusPill status={row.paymentStatus} />
                </div>
                <div className="pay-transfer-grid">
                  <DetailRow label="Customer" value={row.customerName} />
                  <DetailRow label="Expected amount" value={money(row.amount)} />
                  <DetailRow label="Transaction reference" value={row.transactionReference || '—'} />
                  <DetailRow label="Submitted" value={formatDateTime(row.createdAt)} />
                </div>
              </div>
              <div className="pay-transfer-actions">
                {row.receipt && (
                  <button type="button" className="admin-outline-button" onClick={() => openReceipt(row.id)}>
                    View receipt
                  </button>
                )}
                <button type="button" className="admin-outline-button" onClick={() => onView(row.id)}>
                  Details
                </button>
                {status === 'awaiting' && (
                  <>
                    <button type="button" className="admin-primary-button" disabled={busyId === row.id} onClick={() => approve(row)}>
                      {busyId === row.id ? 'Saving…' : 'Verify payment'}
                    </button>
                    <button type="button" className="admin-outline-button danger" disabled={busyId === row.id} onClick={() => reject(row)}>
                      Reject
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Cash on delivery management
// ---------------------------------------------------------------------------

const CodPage = ({ onToast }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('All');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/payments/cod');
      setRows(data);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Cash on delivery orders could not be loaded.', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCollect = (row) => {
    setModal(row);
    setAmount(String(row.amount ?? ''));
    setNote('');
  };

  const submit = async (collected) => {
    if (!modal) return;
    setSaving(true);
    try {
      await api.post(`/admin/payments/cod/${modal.id}/collect`, {
        collected,
        ...(collected ? { amount: amount === '' ? undefined : Number(amount) } : {}),
        note,
      });
      onToast?.(collected ? 'Cash collection recorded and payment marked as paid.' : 'Order marked as not collected.');
      setModal(null);
      await load();
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The collection could not be recorded.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => {
    if (filter === 'All') return rows;
    if (filter === 'Collected') return rows.filter((row) => row.codCollectionStatus === 'Collected');
    if (filter === 'Not Collected') return rows.filter((row) => row.codCollectionStatus === 'Not Collected');
    return rows.filter((row) => row.codCollectionStatus === 'Pending');
  }, [rows, filter]);

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Cash on delivery <span className="admin-count">{visible.length}</span></h2>
          <p>Record cash collection and only mark a payment paid after you confirm it</p>
        </div>
        <select className="admin-filter-select" value={filter} onChange={(event) => setFilter(event.target.value)}>
          {['All', 'Pending', 'Collected', 'Not Collected'].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loader label="Loading cash on delivery orders…" />
      ) : !visible.length ? (
        <EmptyState title="No cash on delivery orders" detail="Orders paid on delivery will be listed here." />
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-data-table pay-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Delivery address</th>
                <th>Amount to collect</th>
                <th>Collection</th>
                <th>Order status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><span className="admin-order-id">{row.orderNumber}</span></td>
                  <td><strong>{row.customerName}</strong></td>
                  <td>{row.customerPhone || '—'}</td>
                  <td><span className="pay-address">{row.deliveryAddress || '—'}</span></td>
                  <td><strong>{money(row.amount)}</strong></td>
                  <td><StatusPill status={row.codCollectionStatus} /></td>
                  <td><StatusPill status={row.orderStatus} /></td>
                  <td>
                    <div className="admin-row-actions">
                      <button type="button" className="admin-text-button" disabled={row.orderStatus === 'Cancelled'} onClick={() => openCollect(row)}>
                        Mark collected
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="cod-modal-title">
            <div className="admin-modal-heading">
              <div>
                <span className="admin-modal-eyebrow">ORDER {modal.orderNumber}</span>
                <h2 id="cod-modal-title">Record cash collection</h2>
              </div>
              <button type="button" className="admin-icon-button" onClick={() => setModal(null)} aria-label="Close">×</button>
            </div>
            <div className="pay-form">
              <p className="pay-muted">Amount due: <strong>{money(modal.amount)}</strong></p>
              <label>
                Collected amount (ETB)
                <input className="pay-input" type="number" min="0" step="0.01" max={modal.amount} value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label>
                Note (optional)
                <textarea className="pay-input" rows="2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Any notes about this collection" />
              </label>
              <div className="admin-modal-actions">
                <button type="button" className="admin-outline-button" disabled={saving} onClick={() => submit(false)}>Mark not collected</button>
                <button type="button" className="admin-primary-button" disabled={saving} onClick={() => submit(true)}>
                  {saving ? 'Saving…' : 'Confirm collection'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Refund management
// ---------------------------------------------------------------------------

const RefundsPage = ({ onToast, onView }) => {
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All statuses');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [paidOrders, setPaidOrders] = useState([]);
  const [createForm, setCreateForm] = useState({ orderId: '', amount: '', reason: '' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 10, ...(search.trim() ? { search: search.trim() } : {}), ...(status !== 'All statuses' ? { status } : {}) };
      const response = await api.get('/admin/payments/refunds', { params });
      setData(response.data);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Refunds could not be loaded.', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, search, status, onToast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openCreate = async () => {
    setCreateForm({ orderId: '', amount: '', reason: '' });
    setShowCreate(true);
    try {
      const response = await api.get('/admin/payments/transactions', { params: { status: 'Paid', limit: 50, sort: 'newest' } });
      setPaidOrders(response.data.items || []);
    } catch (error) {
      onToast?.('Paid transactions could not be loaded.', 'error');
    }
  };

  const submitCreate = async () => {
    if (!createForm.orderId) {
      onToast?.('Select a paid transaction to refund.', 'error');
      return;
    }
    setCreating(true);
    try {
      await api.post('/admin/payments/refunds', {
        orderId: createForm.orderId,
        ...(createForm.amount === '' ? {} : { amount: Number(createForm.amount) }),
        reason: createForm.reason,
      });
      onToast?.('Refund request created.');
      setShowCreate(false);
      setPage(1);
      await load();
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The refund request could not be created.', 'error');
    } finally {
      setCreating(false);
    }
  };

  const review = async (refund, decision) => {
    let note = '';
    if (decision === 'reject') {
      note = window.prompt(`Enter the reason for rejecting refund ${refund.refundNumber}.`);
      if (note === null) return;
      if (!note.trim()) {
        onToast?.('A rejection reason is required.', 'error');
        return;
      }
    } else if (!window.confirm(`Approve refund ${refund.refundNumber} for ${money(refund.amount)}?`)) {
      return;
    }
    setBusyId(refund.id);
    try {
      await api.patch(`/admin/payments/refunds/${refund.id}/review`, { decision, note });
      onToast?.(decision === 'approve' ? 'Refund approved.' : 'Refund rejected.');
      await load();
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The refund could not be updated.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const GATEWAY_REFUND_METHODS = ['Chapa Checkout', 'Credit Card'];

  const process = async (refund) => {
    const gatewayMethod = GATEWAY_REFUND_METHODS.includes(refund.paymentMethod);
    let payload = {};
    if (gatewayMethod) {
      if (!window.confirm(`Send refund ${refund.refundNumber} (${money(refund.amount)}) to the payment provider?`)) return;
    } else {
      const reference = window.prompt(`Enter the refund reference confirming ${refund.refundNumber} was paid out to the customer.`);
      if (reference === null) return;
      if (!reference.trim()) {
        onToast?.('A refund reference is required to complete this refund.', 'error');
        return;
      }
      payload = { providerReference: reference.trim() };
    }
    setBusyId(refund.id);
    try {
      await api.post(`/admin/payments/refunds/${refund.id}/process`, payload);
      onToast?.(gatewayMethod ? 'Refund submitted to the provider.' : 'Refund marked as completed.');
      await load();
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data?.message || 'The refund could not be processed.';
      // The gateway could not start the refund — let the admin record it manually instead.
      if (gatewayMethod && [400, 502, 503].includes(status)) {
        const reference = window.prompt(`${message}\n\nEnter the refund reference confirming the refund was completed outside the gateway.`);
        if (reference && reference.trim()) {
          try {
            await api.post(`/admin/payments/refunds/${refund.id}/process`, { providerReference: reference.trim() });
            onToast?.('Refund marked as completed.');
            await load();
            return;
          } catch (retryError) {
            onToast?.(retryError.response?.data?.message || 'The refund could not be processed.', 'error');
            return;
          }
        }
      }
      onToast?.(message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (refund) => {
    if (!window.confirm(`Confirm that refund ${refund.refundNumber} has settled with the provider and mark it as refunded?`)) return;
    setBusyId(refund.id);
    try {
      await api.post(`/admin/payments/refunds/${refund.id}/complete`, {});
      onToast?.('Refund completed.');
      await load();
    } catch (error) {
      onToast?.(error.response?.data?.message || 'The refund could not be completed.', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Refund management <span className="admin-count">{data.total}</span></h2>
          <p>Review refund requests and process them against the original payment</p>
        </div>
        <button type="button" className="admin-primary-button" onClick={openCreate}>+ New refund request</button>
      </div>

      <div className="pay-filters">
        <input
          className="pay-input pay-search-input"
          type="search"
          placeholder="Search refund ID or order number…"
          value={search}
          onChange={(event) => { setPage(1); setSearch(event.target.value); }}
        />
        <select className="admin-filter-select" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
          {['All statuses', ...REFUND_STATUSES].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <Loader label="Loading refunds…" />
      ) : !data.items.length ? (
        <EmptyState title="No refunds recorded" detail="Refund requests you create will appear here." />
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-data-table pay-table">
            <thead>
              <tr>
                <th>Refund ID</th>
                <th>Order</th>
                <th>Customer</th>
                <th>Original</th>
                <th>Refund</th>
                <th>Reason</th>
                <th>Requested</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((refund) => (
                <tr key={refund.id}>
                  <td><span className="pay-ref">{refund.refundNumber}</span></td>
                  <td><span className="admin-order-id">{refund.orderNumber || '—'}</span></td>
                  <td>
                    <strong>{refund.customerName || 'Customer'}</strong>
                    <span className="admin-cell-subtitle">{refund.customerEmail || '—'}</span>
                  </td>
                  <td>{money(refund.originalAmount)}</td>
                  <td><strong>{money(refund.amount)}</strong></td>
                  <td><span className="pay-address">{refund.reason || '—'}</span></td>
                  <td>{formatDate(refund.requestedAt)}</td>
                  <td><StatusPill status={refund.status} /></td>
                  <td>
                    <div className="admin-row-actions">
                      {refund.orderId && (
                        <button type="button" className="admin-text-button" onClick={() => onView(refund.orderId)}>Details</button>
                      )}
                      {refund.status === 'Requested' && (
                        <>
                          <button type="button" className="admin-text-button" disabled={busyId === refund.id} onClick={() => review(refund, 'approve')}>Approve</button>
                          <button type="button" className="admin-text-button danger" disabled={busyId === refund.id} onClick={() => review(refund, 'reject')}>Reject</button>
                        </>
                      )}
                      {refund.status === 'Approved' && (
                        <button type="button" className="admin-primary-button pay-mini-button" disabled={busyId === refund.id} onClick={() => process(refund)}>
                          Process refund
                        </button>
                      )}
                      {refund.status === 'Processing' && (
                        <button type="button" className="admin-primary-button pay-mini-button" disabled={busyId === refund.id} onClick={() => complete(refund)}>
                          Mark completed
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={data.page} pages={data.pages} total={data.total} onChange={setPage} />

      {showCreate && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="refund-modal-title">
            <div className="admin-modal-heading">
              <div>
                <span className="admin-modal-eyebrow">NEW REFUND</span>
                <h2 id="refund-modal-title">Create refund request</h2>
              </div>
              <button type="button" className="admin-icon-button" onClick={() => setShowCreate(false)} aria-label="Close">×</button>
            </div>
            <div className="pay-form">
              <label>
                Paid transaction
                <select
                  className="pay-input"
                  value={createForm.orderId}
                  onChange={(event) => setCreateForm((current) => ({ ...current, orderId: event.target.value }))}
                >
                  <option value="">Select a paid transaction…</option>
                  {paidOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.orderNumber} · {order.customerName} · {money(order.amount)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Refund amount (ETB) — leave blank for a full refund
                <input
                  className="pay-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={createForm.amount}
                  onChange={(event) => setCreateForm((current) => ({ ...current, amount: event.target.value }))}
                />
              </label>
              <label>
                Reason
                <textarea
                  className="pay-input"
                  rows="2"
                  value={createForm.reason}
                  onChange={(event) => setCreateForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder="Why is this refund being requested?"
                />
              </label>
              <div className="admin-modal-actions">
                <button type="button" className="admin-outline-button" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="button" className="admin-primary-button" disabled={creating} onClick={submitCreate}>
                  {creating ? 'Creating…' : 'Create request'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};

// ---------------------------------------------------------------------------
// Payment settings
// ---------------------------------------------------------------------------

const PaymentSettingsPage = ({ onToast }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bankForm, setBankForm] = useState({ bankName: '', accountName: '', accountNumber: '', branch: '', instructions: '' });

  const apply = useCallback((data) => {
    setSettings(data);
    setBankForm({
      bankName: data.bankTransfer?.bankName || '',
      accountName: data.bankTransfer?.accountName || '',
      accountNumber: data.bankTransfer?.accountNumber || '',
      branch: data.bankTransfer?.branch || '',
      instructions: data.bankTransfer?.instructions || '',
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/payments/settings');
      apply(data);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Payment settings could not be loaded.', 'error');
    } finally {
      setLoading(false);
    }
  }, [apply, onToast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const persist = async (payload, successMessage) => {
    setSaving(true);
    try {
      const { data } = await api.put('/admin/payments/settings', payload);
      apply(data);
      onToast?.(successMessage);
    } catch (error) {
      onToast?.(error.response?.data?.message || 'Payment settings could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleMethod = (method) => {
    const disabled = new Set(settings.disabledMethods || []);
    if (disabled.has(method)) disabled.delete(method);
    else disabled.add(method);
    persist({ disabledMethods: [...disabled] }, `${method} has been updated.`);
  };

  if (loading || !settings) return <Loader label="Loading payment settings…" />;

  const gateway = settings.gateway || {};

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Gateway configuration</h2>
            <p>Connection status for the connected payment gateway</p>
          </div>
          <span className={`pay-gateway-chip ${gateway.configured ? 'online' : 'offline'}`}>
            {gateway.configured ? 'Connected' : 'Not configured'}
          </span>
        </div>
        <div className="pay-detail-rows">
          <DetailRow label="Provider" value={gateway.provider || 'Chapa'} />
          <DetailRow label="Mode" value={gateway.mode === 'live' ? 'Live mode' : 'Test mode'} />
          <DetailRow
            label="Configured methods"
            value={gateway.availableMethods?.length ? gateway.availableMethods.join(', ') : '—'}
          />
          <DetailRow label="Status message" value={gateway.message || '—'} />
        </div>
        <p className="pay-muted pay-gateway-note">
          Secret API keys are stored securely on the server and are never sent to this dashboard.
        </p>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Payment methods</h2>
            <p>Enable or disable the payment methods customers can choose at checkout</p>
          </div>
        </div>
        <div className="pay-method-toggle-list">
          {settings.methods.map((entry) => {
            const online = ONLINE_METHODS.includes(entry.method);
            const blocked = online && !entry.supported;
            return (
              <div className="pay-method-toggle" key={entry.method}>
                <div>
                  <MethodPill method={entry.method} />
                  <span className="admin-cell-subtitle">
                    {blocked
                      ? 'Unavailable — gateway is not configured or does not support this method.'
                      : online
                        ? 'Processed through the payment gateway.'
                        : 'Handled manually by your team.'}
                  </span>
                </div>
                <button
                  type="button"
                  className={`pay-switch ${entry.enabled ? 'on' : 'off'}`}
                  disabled={saving || blocked}
                  aria-pressed={entry.enabled}
                  onClick={() => toggleMethod(entry.method)}
                >
                  <span className="pay-switch-knob" />
                  <span className="pay-switch-label">{entry.enabled ? 'Enabled' : 'Disabled'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="admin-panel">
        <div className="admin-panel-heading">
          <div>
            <h2>Bank transfer settings</h2>
            <p>Account details and instructions customers see when paying by bank transfer</p>
          </div>
        </div>
        <div className="pay-form">
          <div className="admin-form-row">
            <label>Bank name<input className="pay-input" value={bankForm.bankName} onChange={(event) => setBankForm((current) => ({ ...current, bankName: event.target.value }))} /></label>
            <label>Account holder name<input className="pay-input" value={bankForm.accountName} onChange={(event) => setBankForm((current) => ({ ...current, accountName: event.target.value }))} /></label>
          </div>
          <div className="admin-form-row">
            <label>Account number<input className="pay-input" value={bankForm.accountNumber} onChange={(event) => setBankForm((current) => ({ ...current, accountNumber: event.target.value }))} /></label>
            <label>Branch<input className="pay-input" value={bankForm.branch} onChange={(event) => setBankForm((current) => ({ ...current, branch: event.target.value }))} /></label>
          </div>
          <label>
            Payment instructions
            <textarea className="pay-input" rows="3" value={bankForm.instructions} onChange={(event) => setBankForm((current) => ({ ...current, instructions: event.target.value }))} placeholder="e.g. Use your order number as the transfer reference." />
          </label>
          <div className="admin-modal-actions">
            <button type="button" className="admin-primary-button" disabled={saving} onClick={() => persist({ bankTransfer: bankForm }, 'Bank transfer settings saved.')}>
              {saving ? 'Saving…' : 'Save bank transfer settings'}
            </button>
          </div>
        </div>
      </section>
    </>
  );
};

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

const AdminPayments = ({ page, onToast }) => {
  const [detailId, setDetailId] = useState(null);
  const openDetail = useCallback((id) => setDetailId(id), []);

  let content;
  if (page === 'payment-transactions') content = <TransactionsPage onToast={onToast} onView={openDetail} />;
  else if (page === 'payment-bank-transfers') content = <BankTransfersPage onToast={onToast} onView={openDetail} />;
  else if (page === 'payment-cod') content = <CodPage onToast={onToast} />;
  else if (page === 'payment-refunds') content = <RefundsPage onToast={onToast} onView={openDetail} />;
  else if (page === 'payment-settings') content = <PaymentSettingsPage onToast={onToast} />;
  else content = <PaymentOverview onToast={onToast} onView={openDetail} />;

  return (
    <>
      {content}
      {detailId && <TransactionDetailsModal id={detailId} onClose={() => setDetailId(null)} onToast={onToast} />}
    </>
  );
};

export default AdminPayments;
