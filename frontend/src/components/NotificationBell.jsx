import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const NotificationBell = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const panelRef = useRef(null);
  const unreadCount = notifications.filter((notification) => !notification.readAt).length;

  const loadNotifications = useCallback(async () => {
    try {
      const { data } = await api.get('/customer/notifications');
      setNotifications(Array.isArray(data) ? data : []);
      setError('');
    } catch (requestError) {
      console.error('Failed to load customer notifications:', requestError);
      setError(requestError.response?.data?.message || 'Notifications could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (user?.role !== 'customer') return undefined;
    const timer = window.setTimeout(loadNotifications, 0);
    const interval = window.setInterval(loadNotifications, 60000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [user?._id, user?.role, loadNotifications]);

  useEffect(() => {
    if (!open || user?.role !== 'customer') return undefined;
    const timer = window.setTimeout(loadNotifications, 0);
    return () => window.clearTimeout(timer);
  }, [open, user?.role, loadNotifications]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!panelRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  if (user?.role !== 'customer') return null;

  const markRead = async (notification) => {
    if (notification.readAt) return;
    try {
      const { data } = await api.patch(`/customer/notifications/${notification._id}/read`);
      setNotifications((current) => current.map((entry) => entry._id === data._id ? data : entry));
    } catch (requestError) {
      console.error('Failed to mark notification as read:', requestError);
      setError(requestError.response?.data?.message || 'Notification could not be marked as read.');
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch('/customer/notifications/read-all');
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((notification) => ({ ...notification, readAt: notification.readAt || readAt })));
    } catch (requestError) {
      console.error('Failed to mark all notifications as read:', requestError);
      setError(requestError.response?.data?.message || 'Notifications could not be marked as read.');
    }
  };

  const openNotification = async (notification) => {
    await markRead(notification);
    setOpen(false);
    if (notification.link) navigate(notification.link);
  };

  return (
    <div className="customer-notifications" ref={panelRef}>
      <button
        type="button"
        className="store-nav-action notification-bell"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg><span>Updates</span>
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-panel" role="dialog" aria-label="Customer notifications">
          <div className="notification-panel-heading">
            <strong>Updates</strong>
            {unreadCount > 0 && <button type="button" onClick={markAllRead}>Mark all read</button>}
          </div>
          {error && <p role="alert">{error}</p>}
          {notifications.length ? notifications.map((notification) => (
            <button
              type="button"
              className={`notification-item${notification.readAt ? '' : ' unread'}`}
              key={notification._id}
              onClick={() => openNotification(notification)}
            >
              <strong>{notification.title}</strong>
              <span>{notification.message}</span>
              <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
            </button>
          )) : !error && <p className="notification-empty">No updates yet.</p>}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
