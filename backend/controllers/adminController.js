const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { toEtbMongoExpression } = require('../utils/currency');

const getOverview = async (req, res, next) => {
  try {
    const [products, users, orders] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments(),
    ]);

    return res.json({ products, users, orders });
  } catch (error) {
    return next(error);
  }
};

const getCustomers = async (req, res, next) => {
  try {
    const [customers, orderStats] = await Promise.all([
      User.find({ role: 'customer' }).select('_id name email createdAt').sort({ createdAt: -1 }).lean(),
      Order.aggregate([
        {
          $group: {
            _id: '$user',
            totalOrders: { $sum: 1 },
            totalSpending: {
              $sum: {
                $cond: [
                  { $ne: ['$orderStatus', 'Cancelled'] },
                  toEtbMongoExpression('$totalPrice', '$currency'),
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const statsByCustomer = new Map(orderStats.map((stats) => [stats._id.toString(), stats]));
    return res.json(
      customers.map((customer) => {
        const stats = statsByCustomer.get(customer._id.toString());
        return {
          ...customer,
          totalOrders: stats?.totalOrders || 0,
          totalSpending: stats?.totalSpending || 0,
          currency: 'ETB',
        };
      })
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = { getOverview, getCustomers };
