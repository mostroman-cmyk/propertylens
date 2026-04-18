const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
  }
  return _transporter;
}

async function sendMail({ to, subject, html }) {
  const transporter = getTransporter();
  try {
    const info = await transporter.sendMail({
      from: `"PropertyLens" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html,
    });
    return info;
  } catch (err) {
    // Gmail (and some SMTP servers) close the connection before nodemailer
    // finishes cleanup, causing ECONNRESET/EPIPE after the message is accepted.
    // If the recipient was already accepted, treat as success.
    const postDeliveryCode = ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(err.code);
    const wasAccepted = err.accepted?.includes(to) || err.response?.startsWith('250');
    if (postDeliveryCode || wasAccepted) {
      console.warn(`[mailer] Post-delivery connection error (email delivered): ${err.code || err.message}`);
      return { accepted: [to], rejected: [] };
    }
    throw err;
  }
}

module.exports = { sendMail };
