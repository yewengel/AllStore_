const Notification = require('../models/Notification');

const createNotification = (userId, details) => Notification.create({
  user: userId,
  ...details,
});

module.exports = { createNotification };
