const createPasswordResetHandlers = require('./passwordResetControllerFactory');

const adminPasswordResetHandlers = createPasswordResetHandlers({
  role: 'admin',
  minimumPasswordLength: 12,
});

module.exports = {
  requestAdminPasswordReset: adminPasswordResetHandlers.request,
  verifyAdminPasswordResetCode: adminPasswordResetHandlers.verify,
  resetAdminPassword: adminPasswordResetHandlers.reset,
};
