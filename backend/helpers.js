const db = require('./db');

function log(userId, type, message) {
  db.prepare('INSERT INTO activity_logs (user_id,type,message) VALUES (?,?,?)').run(userId, type, message);
}
function render(text, lead, user, industry) {
  const values = {
    company: lead.company_name || '',
    website: lead.website || '',
    industry: industry?.name || '',
    email: lead.email || '',
    sender: user.name || '',
    signature: user.signature || ''
  };
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
}
function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}
module.exports = { log, render, publicUser };
