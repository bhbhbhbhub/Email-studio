const nodemailer = require('nodemailer');
const db = require('./db');

async function transporterFor(userId) {
  const account = db.prepare("SELECT * FROM connected_accounts WHERE user_id=? AND status='connected' ORDER BY id DESC LIMIT 1").get(userId);
  if (!account) throw new Error('Connect a Gmail or Outlook account before sending.');
  const service = account.provider === 'google' ? 'gmail' : 'hotmail';
  return {
    account,
    transport: nodemailer.createTransport({
      service,
      auth: {
        type: 'OAuth2', user: account.email,
        accessToken: account.access_token, refreshToken: account.refresh_token,
        clientId: account.provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.MICROSOFT_CLIENT_ID,
        clientSecret: account.provider === 'google' ? process.env.GOOGLE_CLIENT_SECRET : process.env.MICROSOFT_CLIENT_SECRET
      }
    })
  };
}
async function sendLead(userId, lead) {
  const { account, transport } = await transporterFor(userId);
  await transport.sendMail({ from: account.email, to: lead.email, subject: lead.generated_subject, html: String(lead.generated_body || '').replace(/\n/g, '<br>') });
}
module.exports = { sendLead };
