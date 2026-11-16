const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const AdminPasswordReset = require('../models/AdminPasswordReset');
const User = require('../models/User');
const { getJwtSecret } = require('../middleware/auth');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const INVALID_CODE_MESSAGE = 'The verification code is invalid or expired.';

const normalizeEmail = (email) => (
  typeof email === 'string' ? email.trim().toLowerCase() : ''
);

const isValidEmail = (email) => (
  email.length <= 254 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
);

const hashValue = (userId, value, purpose) => crypto
  .createHmac('sha256', getJwtSecret())
  .update(`allstore:${purpose}:${userId}:${value}`)
  .digest('hex');

const safeEqualHex = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

const sendResetCode = async ({ email, code, role }) => {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  const username = process.env.SMTP_USER;
  const password = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM?.trim();

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !['true', 'false'].includes(secureValue) ||
    !username ||
    !password ||
    !from
  ) {
    throw new Error('SMTP configuration is incomplete.');
  }

  const recipientLabel = role === 'admin' ? 'administrator' : 'customer';
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: secureValue === 'true',
    auth: { user: username, pass: password },
  });

  await transporter.sendMail({
    from,
    to: email,
    subject: `Your AllStore ${role} password reset code`,
    text: [
      `AllStore ${recipientLabel} password reset`,
      '',
      `Your verification code is: ${code}`,
      'This code expires in 10 minutes.',
      'If you did not request a password reset, ignore this email. Your password will not change.',
    ].join('\n'),
    html: [
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#302336">',
      '<h1 style="color:#49354d">AllStore</h1>',
      `<h2>Reset your ${recipientLabel} password</h2>`,
      '<p>Use this verification code to continue:</p>',
      `<p style="font-size:30px;font-weight:700;letter-spacing:8px">${code}</p>`,
      '<p>This code expires in <strong>10 minutes</strong>.</p>',
      '<p>If you did not request a password reset, ignore this email. Your password will not change.</p>',
      '<p style="color:#766d78">AllStore · Shop Smart. Live Better.</p>',
      '</div>',
    ].join(''),
  });
};

const createPasswordResetHandlers = ({ role, minimumPasswordLength }) => {
  if (!['admin', 'customer'].includes(role)) {
    throw new TypeError('Password reset handlers require a supported account role.');
  }

  const capitalizedRole = role[0].toUpperCase() + role.slice(1);
  const genericAccountPhrase = role === 'admin'
    ? 'an administrator account'
    : 'a customer account';
  const genericRequestResponse = {
    message: `If ${genericAccountPhrase} exists for this email, a verification code will be sent.`,
  };

  const request = async (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    if (!isValidEmail(email)) return res.json(genericRequestResponse);

    try {
      const user = await User.findOne({ email, role });
      if (!user) return res.json(genericRequestResponse);

      const now = new Date();
      const issuanceId = crypto.randomUUID();
      const resendAllowedAt = new Date(now.getTime() + RESEND_COOLDOWN_MS);
      let reservation = await AdminPasswordReset.findOneAndUpdate(
        {
          user: user._id,
          $or: [
            { resendAllowedAt: { $exists: false } },
            { resendAllowedAt: { $lte: now } },
          ],
        },
        { $set: { resendAllowedAt, issuanceId } },
        { new: true }
      );

      if (!reservation) {
        try {
          reservation = await AdminPasswordReset.create({
            user: user._id,
            state: 'issuing',
            resendAllowedAt,
            issuanceId,
          });
        } catch (error) {
          if (error.code === 11000) return res.json(genericRequestResponse);
          throw error;
        }
      }

      const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
      try {
        await sendResetCode({ email, code, role });
      } catch (error) {
        await AdminPasswordReset.updateOne(
          { user: user._id, issuanceId },
          { $set: { resendAllowedAt: new Date() }, $unset: { issuanceId: 1 } }
        );
        console.error(`${capitalizedRole} password reset email delivery failed.`);
        return res.json(genericRequestResponse);
      }

      const saved = await AdminPasswordReset.updateOne(
        { user: user._id, issuanceId },
        {
          $set: {
            state: 'pending',
            codeHash: hashValue(user._id, code, 'verification-code'),
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
            attempts: 0,
            resetTokenHash: null,
            resetExpiresAt: null,
          },
          $unset: { issuanceId: 1 },
        }
      );
      if (!saved.matchedCount) {
        console.error(`${capitalizedRole} password reset request could not be finalized.`);
      }
      return res.json(genericRequestResponse);
    } catch (error) {
      return next(error);
    }
  };

  const verify = async (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ status: 'error', message: INVALID_CODE_MESSAGE });
    }

    try {
      const user = await User.findOne({ email, role });
      if (!user) return res.status(400).json({ status: 'error', message: INVALID_CODE_MESSAGE });

      const now = new Date();
      const reset = await AdminPasswordReset.findOne({ user: user._id }).select('+codeHash');
      if (
        !reset ||
        reset.state !== 'pending' ||
        !reset.codeHash ||
        reset.attempts >= MAX_CODE_ATTEMPTS ||
        !reset.expiresAt ||
        reset.expiresAt <= now
      ) {
        return res.status(400).json({ status: 'error', message: INVALID_CODE_MESSAGE });
      }

      const suppliedHash = hashValue(user._id, code, 'verification-code');
      if (!safeEqualHex(reset.codeHash, suppliedHash)) {
        const failedAttempt = await AdminPasswordReset.findOneAndUpdate(
          {
            _id: reset._id,
            state: 'pending',
            codeHash: reset.codeHash,
            attempts: { $lt: MAX_CODE_ATTEMPTS },
            expiresAt: { $gt: now },
          },
          { $inc: { attempts: 1 } },
          { new: true }
        );
        if (failedAttempt?.attempts >= MAX_CODE_ATTEMPTS) {
          await AdminPasswordReset.updateOne(
            { _id: reset._id, state: 'pending', attempts: { $gte: MAX_CODE_ATTEMPTS } },
            { $set: { state: 'locked', codeHash: null } }
          );
        }
        return res.status(400).json({ status: 'error', message: INVALID_CODE_MESSAGE });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
      const consumed = await AdminPasswordReset.findOneAndUpdate(
        {
          _id: reset._id,
          state: 'pending',
          codeHash: reset.codeHash,
          attempts: { $lt: MAX_CODE_ATTEMPTS },
          expiresAt: { $gt: now },
        },
        {
          $set: {
            state: 'verified',
            codeHash: null,
            resetTokenHash: hashValue(user._id, resetToken, 'reset-token'),
            resetExpiresAt,
            expiresAt: resetExpiresAt,
          },
        },
        { new: true }
      );
      if (!consumed) return res.status(400).json({ status: 'error', message: INVALID_CODE_MESSAGE });

      return res.json({ resetToken });
    } catch (error) {
      return next(error);
    }
  };

  const reset = async (req, res, next) => {
    const email = normalizeEmail(req.body?.email);
    const resetToken = typeof req.body?.resetToken === 'string' ? req.body.resetToken : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (
      !isValidEmail(email) ||
      !/^[a-f0-9]{64}$/i.test(resetToken) ||
      newPassword.length < minimumPasswordLength ||
      Buffer.byteLength(newPassword, 'utf8') > 72
    ) {
      return res.status(400).json({
        status: 'error',
        message: 'The reset request is invalid or expired, or the password does not meet the requirements.',
      });
    }

    try {
      const user = await User.findOne({ email, role });
      if (!user) return res.status(400).json({ status: 'error', message: 'The reset request is invalid or expired.' });

      const now = new Date();
      const consumed = await AdminPasswordReset.findOneAndUpdate(
        {
          user: user._id,
          state: 'verified',
          resetTokenHash: hashValue(user._id, resetToken, 'reset-token'),
          resetExpiresAt: { $gt: now },
        },
        { $set: { state: 'consuming', resetTokenHash: null, codeHash: null } },
        { new: true }
      );
      if (!consumed) {
        return res.status(400).json({ status: 'error', message: 'The reset request is invalid or expired.' });
      }

      user.password = newPassword;
      await user.save();
      await AdminPasswordReset.deleteOne({ user: user._id });
      return res.json({ message: 'Your password has been reset. You can now sign in.' });
    } catch (error) {
      return next(error);
    }
  };

  return { request, verify, reset };
};

module.exports = createPasswordResetHandlers;
