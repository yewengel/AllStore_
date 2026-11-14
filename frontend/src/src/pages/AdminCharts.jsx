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
import { formatDualCurrency } from '../utils/currency';

const periodLabels = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const AdminCharts = ({ analytics, period, onPeriodChange, reportMode = false }) => (
  <section className={`admin-panel analytics-panel${reportMode ? ' report-analytics-panel' : ''}`}>
    <div className="admin-panel-heading analytics-heading">
      <div>
        <h2>{reportMode ? 'Sales performance' : 'Sales analytics'}</h2>
        <p>{reportMode ? 'Revenue and order trends from real order records' : 'Revenue and order volume from your store'}</p>
      </div>
      <div className="admin-period-tabs" aria-label="Analytics period">
        {Object.entries(periodLabels).map(([key, label]) => (
          <button type="button" key={key} className={period === key ? 'selected' : ''} onClick={() => onPeriodChange(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
    <div className="analytics-summary">
      <div><span>Revenue this period</span><strong>{formatDualCurrency(analytics.revenue, 'ETB')}</strong></div>
      <span className={`analytics-change ${analytics.change !== null && analytics.change < 0 ? 'negative' : ''}`}>
        {analytics.change === null ? 'New' : `${analytics.change >= 0 ? '↑' : '↓'} ${Math.abs(analytics.change).toFixed(1)}%`}
        <span>vs previous period</span>
      </span>
    </div>
    <div className={reportMode ? 'admin-report-charts' : 'admin-chart-grid'}>
      <div className="admin-chart">
        <div className="admin-chart-title"><strong>Revenue</strong><span>ETB / USD</span></div>
        <ResponsiveContainer width="100%" height={reportMode ? 300 : 220}>
          <AreaChart data={analytics.buckets} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={reportMode ? 'reportFill' : 'revenueFill'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--deep-plum)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--deep-plum)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#eee7df" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} minTickGap={18} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} tickFormatter={(value) => formatDualCurrency(value, 'ETB')} width={126} />
            <Tooltip formatter={(value) => formatDualCurrency(value, 'ETB')} contentStyle={{ borderRadius: 9, border: '1px solid #e7ded4', boxShadow: '0 8px 24px rgb(53 33 59 / 0.08)' }} />
            <Area type="monotone" dataKey="revenue" stroke="var(--deep-plum)" strokeWidth={2.5} fill={`url(#${reportMode ? 'reportFill' : 'revenueFill'})`} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="admin-chart">
        <div className="admin-chart-title"><strong>Orders</strong><span>Orders</span></div>
        <ResponsiveContainer width="100%" height={reportMode ? 300 : 220}>
          <BarChart data={analytics.buckets} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#eee7df" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} minTickGap={18} />
            <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#8b9099', fontSize: 11 }} width={32} />
            <Tooltip formatter={(value) => [value, 'Orders']} contentStyle={{ borderRadius: 9, border: '1px solid #e7ded4', boxShadow: '0 8px 24px rgb(53 33 59 / 0.08)' }} />
            <Bar dataKey="orders" fill="var(--deep-plum)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  </section>
);

export default AdminCharts;
