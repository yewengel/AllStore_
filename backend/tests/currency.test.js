const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ETB_PER_USD = '164.62';

const {
  ETB_PER_USD,
  toEtb,
  toEtbMongoExpression,
} = require('../utils/currency');

test('uses the configured default rate and converts legacy USD values', () => {
  assert.equal(ETB_PER_USD, 164.62);
  assert.equal(toEtb(21.99), 3619.99);
});

test('keeps ETB prices in ETB and converts legacy records without a currency marker as USD', () => {
  assert.equal(toEtb(3618.19, 'ETB'), 3618.19);
  assert.equal(toEtb(21.99, undefined), 3619.99);
});

test('rejects invalid amounts and produces a currency-aware Mongo expression', () => {
  assert.throws(() => toEtb(Number.NaN, 'ETB'), /finite number/);
  assert.deepEqual(toEtbMongoExpression('$price', '$currency'), {
    $cond: [
      { $eq: ['$currency', 'ETB'] },
      '$price',
      { $multiply: ['$price', 164.62] },
    ],
  });
});
