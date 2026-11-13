const mongoose = require('mongoose');

const orderCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    sequence: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { versionKey: false }
);

module.exports = mongoose.model('OrderCounter', orderCounterSchema);
