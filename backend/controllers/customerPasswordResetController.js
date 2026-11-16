const createPasswordResetHandlers = require('./passwordResetControllerFactory');

const customerPasswordResetHandlers = createPasswordResetHandlers({
  role: 'customer',
  minimumPasswordLength: 6,
});

module.exports = {
  requestCustomerPasswordReset: customerPasswordResetHandlers.request,
  verifyCustomerPasswordResetCode: customerPasswordResetHandlers.verify,
  resetCustomerPassword: customerPasswordResetHandlers.reset,
};
