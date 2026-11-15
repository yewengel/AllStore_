const Notification = require('../../models/Notification');

Notification.create = async (notification) => ({
  ...notification,
  _id: notification._id || 'mock-notification-id',
});
