require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { parse } = require('csv-parse/sync');
const db = require('./db');
const { sign, auth } = require('./auth');
const { log, render, publicUser } = require('./helpers');
const { sendLead } = require('./mailer');

const app = express();
const port = process.env.PORT || 3000;
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } });
const queues = new Map();

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ error: 'Name, email, and an 8+ character password are required.' });
  try {
    const result = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 12));
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(result.lastInsertRowid);
    log(result.lastInsertRowid, 'account', 'Account created');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    res.status(201).json({ token: sign(user), user: publicUser(user) });
  } catch (e) { res.status(409).json({ error: 'An account with that email already exists.' }); }
});
app.post('/api/auth/login', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'Invalid email or password.' });
  log(user.id, 'login', 'Signed in');
  res.json({ token: sign(user), user: publicUser(user) });
});
app.post('/api/auth/forgot', (req, res) => res.json({ message: 'If that account exists, contact your workspace administrator to reset it.' }));

app.use('/api', auth);
app.get('/api/me', (req, res) => res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))));
app.put('/api/me', (req, res) => {
  const { name, company_name, signature } = req.body;
  db.prepare('UPDATE users SET name=?,company_name=?,signature=? WHERE id=?').run(name, company_name || '', signature || '', req.user.id);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)));
});
app.get('/api/dashboard', (req, res) => {
  const id = req.user.id;
  const count = (table, where = '') => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id=? ${where}`).get(id).n;
  res.json({
    stats: { leads: count('leads'), industries: count('industries'), templates: count('templates'), pending: count('leads', "AND status IN ('Pending','Generated','Sending')"), sent: count('leads', "AND status='Sent'"), failed: count('leads', "AND status='Failed'") },
    account: db.prepare('SELECT id,provider,email,status FROM connected_accounts WHERE user_id=? ORDER BY id DESC LIMIT 1').get(id) || null,
    activity: db.prepare('SELECT * FROM activity_logs WHERE user_id=? ORDER BY id DESC LIMIT 12').all(id)
  });
});

app.get('/api/industries', (req, res) => res.json(db.prepare(`SELECT i.*, COUNT(l.id) lead_count,
  (SELECT id FROM templates t WHERE t.industry_id=i.id AND t.is_default=1 LIMIT 1) template_id
  FROM industries i LEFT JOIN leads l ON l.industry_id=i.id WHERE i.user_id=? GROUP BY i.id ORDER BY i.name`).all(req.user.id)));
app.post('/api/industries', (req, res) => {
  try {
    const r = db.prepare('INSERT INTO industries (user_id,name,color,icon) VALUES (?,?,?,?)').run(req.user.id, req.body.name, req.body.color || '#8b5cf6', req.body.icon || 'building');
    log(req.user.id, 'industry', `Created industry ${req.body.name}`);
    res.status(201).json(db.prepare('SELECT * FROM industries WHERE id=?').get(r.lastInsertRowid));
  } catch { res.status(409).json({ error: 'Industry names must be unique.' }); }
});
app.put('/api/industries/:id', (req, res) => {
  db.prepare('UPDATE industries SET name=?,color=?,icon=? WHERE id=? AND user_id=?').run(req.body.name, req.body.color, req.body.icon, req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/industries/:id', (req, res) => {
  db.prepare('DELETE FROM industries WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/api/templates', (req, res) => res.json(db.prepare(`SELECT t.*,i.name industry_name,i.color industry_color FROM templates t LEFT JOIN industries i ON i.id=t.industry_id WHERE t.user_id=? ORDER BY t.updated_at DESC`).all(req.user.id)));
app.post('/api/templates', (req, res) => {
  const { industry_id, name, subject, body, is_default = 1 } = req.body;
  const tx = db.transaction(() => {
    if (is_default && industry_id) db.prepare('UPDATE templates SET is_default=0 WHERE user_id=? AND industry_id=?').run(req.user.id, industry_id);
    return db.prepare('INSERT INTO templates (user_id,industry_id,name,subject,body,is_default) VALUES (?,?,?,?,?,?)').run(req.user.id, industry_id || null, name, subject, body, is_default ? 1 : 0);
  });
  const r = tx(); log(req.user.id, 'template', `Created template ${name}`);
  res.status(201).json(db.prepare('SELECT * FROM templates WHERE id=?').get(r.lastInsertRowid));
});
app.put('/api/templates/:id', (req, res) => {
  const { industry_id, name, subject, body, is_default = 1 } = req.body;
  const tx = db.transaction(() => {
    if (is_default && industry_id) db.prepare('UPDATE templates SET is_default=0 WHERE user_id=? AND industry_id=?').run(req.user.id, industry_id);
    db.prepare("UPDATE templates SET industry_id=?,name=?,subject=?,body=?,is_default=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").run(industry_id || null, name, subject, body, is_default ? 1 : 0, req.params.id, req.user.id);
  }); tx(); log(req.user.id, 'template', `Edited template ${name}`); res.json({ ok: true });
});
app.post('/api/templates/:id/duplicate', (req, res) => {
  const t = db.prepare('SELECT * FROM templates WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  const r = db.prepare('INSERT INTO templates (user_id,industry_id,name,subject,body,is_default) VALUES (?,?,?,?,?,0)').run(req.user.id, t.industry_id, `${t.name} copy`, t.subject, t.body);
  res.status(201).json({ id: r.lastInsertRowid });
});
app.delete('/api/templates/:id', (req, res) => { db.prepare('DELETE FROM templates WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

app.get('/api/leads', (req, res) => {
  const q = `%${req.query.search || ''}%`, status = req.query.status || '', industry = req.query.industry || '';
  const sortMap = { company: 'l.company_name', email: 'l.email', status: 'l.status', created: 'l.created_at' };
  const sort = sortMap[req.query.sort] || 'l.created_at', dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  res.json(db.prepare(`SELECT l.*,i.name industry_name,i.color industry_color FROM leads l LEFT JOIN industries i ON i.id=l.industry_id
    WHERE l.user_id=? AND (l.company_name LIKE ? OR l.email LIKE ? OR l.website LIKE ?)
    AND (?='' OR l.status=?) AND (?='' OR l.industry_id=?) ORDER BY ${sort} ${dir}`).all(req.user.id, q, q, q, status, status, industry, industry));
});
app.post('/api/leads', (req, res) => {
  const { company_name, website, email, industry_id, notes } = req.body;
  if (!company_name || !email) return res.status(400).json({ error: 'Company and email are required.' });
  const r = db.prepare('INSERT INTO leads (user_id,company_name,website,email,industry_id,notes) VALUES (?,?,?,?,?,?)').run(req.user.id, company_name, website || '', email, industry_id || null, notes || '');
  res.status(201).json({ id: r.lastInsertRowid });
});
app.put('/api/leads/:id', (req, res) => {
  const { company_name, website, email, industry_id, status, notes, generated_subject, generated_body } = req.body;
  db.prepare('UPDATE leads SET company_name=?,website=?,email=?,industry_id=?,status=?,notes=?,generated_subject=COALESCE(?,generated_subject),generated_body=COALESCE(?,generated_body) WHERE id=? AND user_id=?').run(company_name, website || '', email, industry_id || null, status || 'Pending', notes || '', generated_subject ?? null, generated_body ?? null, req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/leads/:id', (req, res) => { db.prepare('DELETE FROM leads WHERE id=? AND user_id=?').run(req.params.id, req.user.id); res.json({ ok: true }); });

function importRows(userId, rows) {
  const industries = db.prepare('SELECT * FROM industries WHERE user_id=?').all(userId);
  const findIndustry = name => industries.find(i => i.name.toLowerCase() === String(name || '').trim().toLowerCase())?.id || null;
  const insert = db.prepare('INSERT INTO leads (user_id,company_name,website,email,industry_id,notes) VALUES (?,?,?,?,?,?)');
  const tx = db.transaction(items => items.forEach(row => {
    const normalized = Object.fromEntries(Object.entries(row).map(([k,v]) => [k.toLowerCase().replace(/[^a-z]/g,''), v]));
    const email = normalized.email || normalized.emailaddress;
    if (email) insert.run(userId, normalized.companyname || normalized.company || 'Unknown', normalized.website || '', email, findIndustry(normalized.industry), normalized.notes || '');
  })); tx(rows); return rows.length;
}
async function excelRows(bufferOrPath, fromBuffer = false) {
  const workbook = new ExcelJS.Workbook();
  if (fromBuffer) await workbook.xlsx.load(bufferOrPath); else await workbook.xlsx.readFile(bufferOrPath);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 1) return [];
  const headers = sheet.getRow(1).values.slice(1).map(String);
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const item = {};
    headers.forEach((header, i) => {
      const cell = row.getCell(i + 1).value;
      item[header] = cell?.text || cell?.result || cell || '';
    });
    rows.push(item);
  });
  return rows;
}
app.post('/api/import/file', upload.single('file'), async (req, res) => {
  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rows;
    if (ext === '.csv') rows = parse(fs.readFileSync(req.file.path, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
    else rows = await excelRows(req.file.path);
    fs.unlinkSync(req.file.path); const n = importRows(req.user.id, rows); log(req.user.id, 'import', `Imported ${n} leads`);
    res.json({ imported: n });
  } catch (e) { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); res.status(400).json({ error: 'Could not read that file. Use CSV or XLSX with an Email column.' }); }
});
app.post('/api/import/link', async (req, res) => {
  try {
    let url = req.body.url;
    if (/docs\.google\.com\/spreadsheets/.test(url)) url = url.replace(/\/edit.*$/, '/export?format=csv');
    const response = await fetch(url); if (!response.ok) throw new Error();
    const buf = Buffer.from(await response.arrayBuffer());
    let rows;
    try { rows = parse(buf.toString(), { columns: true, skip_empty_lines: true, trim: true }); }
    catch { rows = await excelRows(buf, true); }
    const n = importRows(req.user.id, rows); log(req.user.id, 'import', `Imported ${n} leads from a link`); res.json({ imported: n });
  } catch { res.status(400).json({ error: 'The sheet could not be downloaded. Make sure link sharing is enabled.' }); }
});

app.post('/api/generate', (req, res) => {
  const ids = req.body.ids || [];
  const leads = ids.length ? db.prepare(`SELECT * FROM leads WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(req.user.id, ...ids) : db.prepare("SELECT * FROM leads WHERE user_id=? AND status IN ('Pending','Failed')").all(req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const getIndustry = db.prepare('SELECT * FROM industries WHERE id=?');
  const getTemplate = db.prepare('SELECT * FROM templates WHERE user_id=? AND industry_id=? AND is_default=1 LIMIT 1');
  const update = db.prepare("UPDATE leads SET generated_subject=?,generated_body=?,status='Generated' WHERE id=?");
  let generated = 0, skipped = 0;
  for (const lead of leads) {
    const industry = getIndustry.get(lead.industry_id), template = getTemplate.get(req.user.id, lead.industry_id);
    if (!template) { skipped++; continue; }
    update.run(render(template.subject, lead, user, industry), render(template.body, lead, user, industry), lead.id); generated++;
  }
  log(req.user.id, 'generation', `Generated ${generated} emails`); res.json({ generated, skipped });
});

app.get('/api/queue', (req, res) => res.json(queues.get(req.user.id) || { status: 'idle', total: 0, completed: 0, failed: 0 }));
app.post('/api/send', async (req, res) => {
  if (queues.get(req.user.id)?.status === 'running') return res.status(409).json({ error: 'A sending queue is already running.' });
  const ids = req.body.ids || [];
  const leads = ids.length ? db.prepare(`SELECT * FROM leads WHERE user_id=? AND generated_subject IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).all(req.user.id, ...ids) : db.prepare("SELECT * FROM leads WHERE user_id=? AND status IN ('Generated','Failed') AND generated_subject IS NOT NULL").all(req.user.id);
  if (!leads.length) return res.status(400).json({ error: 'Generate at least one email first.' });
  const settings = db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id);
  const queue = { status: 'running', total: leads.length, completed: 0, failed: 0, cancelled: false };
  queues.set(req.user.id, queue); res.json(queue);
  (async () => {
    for (const lead of leads) {
      while (queue.status === 'paused') await new Promise(r => setTimeout(r, 500));
      if (queue.cancelled) break;
      db.prepare("UPDATE leads SET status='Sending' WHERE id=?").run(lead.id);
      try {
        await sendLead(req.user.id, lead);
        db.prepare("UPDATE leads SET status='Sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").run(lead.id);
        queue.completed++; log(req.user.id, 'sent', `Email sent to ${lead.email}`);
      } catch (e) {
        db.prepare("UPDATE leads SET status='Failed' WHERE id=?").run(lead.id);
        queue.failed++; log(req.user.id, 'failed', `Email failed for ${lead.email}: ${e.message}`);
      }
      if (!queue.cancelled) await new Promise(r => setTimeout(r, Math.max(0, settings?.sending_delay || 3) * 1000));
    }
    queue.status = queue.cancelled ? 'cancelled' : 'complete';
  })();
});
app.post('/api/queue/:action', (req, res) => {
  const q = queues.get(req.user.id); if (!q) return res.status(404).json({ error: 'No queue found.' });
  if (req.params.action === 'pause' && q.status === 'running') q.status = 'paused';
  if (req.params.action === 'resume' && q.status === 'paused') q.status = 'running';
  if (req.params.action === 'cancel') { q.cancelled = true; q.status = 'cancelled'; }
  res.json(q);
});

app.get('/api/settings', (req, res) => res.json(db.prepare('SELECT * FROM settings WHERE user_id=?').get(req.user.id)));
app.put('/api/settings', (req, res) => {
  db.prepare('UPDATE settings SET theme=?,notifications=?,sending_delay=? WHERE user_id=?').run(req.body.theme || 'dark', req.body.notifications ? 1 : 0, Math.max(0, Number(req.body.sending_delay) || 0), req.user.id); res.json({ ok: true });
});

// Google APIs are loaded lazily so ordinary app startup stays fast when OAuth is not used.
function googleClient() {
  const { google } = require('googleapis');
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${appUrl}/oauth/google/callback`);
}
app.get('/api/oauth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth is not configured by your administrator.' });
  res.json({ url: googleClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/gmail.send','https://www.googleapis.com/auth/userinfo.email'], state: sign({ id: req.user.id, email: req.user.email }) }) });
});
app.get('/oauth/google/callback', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const jwt = require('jsonwebtoken').verify(req.query.state, process.env.JWT_SECRET || 'development-only-change-me');
    const client = googleClient(), { tokens } = await client.getToken(req.query.code); client.setCredentials(tokens);
    const info = await google.oauth('v2').userinfo.get({ auth: client });
    db.prepare(`INSERT INTO connected_accounts (user_id,provider,email,access_token,refresh_token,expires_at,status) VALUES (?,?,?,?,?,?,'connected')
      ON CONFLICT(user_id,provider) DO UPDATE SET email=excluded.email,access_token=excluded.access_token,refresh_token=COALESCE(excluded.refresh_token,refresh_token),expires_at=excluded.expires_at,status='connected'`)
      .run(jwt.id, 'google', info.data.email, tokens.access_token, tokens.refresh_token, tokens.expiry_date);
    log(jwt.id, 'account', `Connected Gmail ${info.data.email}`); res.redirect('/#settings?connected=1');
  } catch { res.redirect('/#settings?oauthError=1'); }
});
app.get('/api/oauth/microsoft', (req, res) => {
  if (!process.env.MICROSOFT_CLIENT_ID) return res.status(503).json({ error: 'Microsoft OAuth is not configured by your administrator.' });
  const tenant = process.env.MICROSOFT_TENANT || 'common';
  const p = new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, response_type: 'code', redirect_uri: `${appUrl}/oauth/microsoft/callback`, response_mode: 'query', scope: 'offline_access User.Read Mail.Send', state: sign({ id: req.user.id, email: req.user.email }) });
  res.json({ url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}` });
});
app.get('/oauth/microsoft/callback', async (req, res) => {
  try {
    const jwt = require('jsonwebtoken').verify(req.query.state, process.env.JWT_SECRET || 'development-only-change-me');
    const tenant = process.env.MICROSOFT_TENANT || 'common';
    const p = new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, code: req.query.code, redirect_uri: `${appUrl}/oauth/microsoft/callback`, grant_type: 'authorization_code', scope: 'offline_access User.Read Mail.Send' });
    const token = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: 'POST', headers: {'content-type':'application/x-www-form-urlencoded'}, body: p }).then(r => r.json());
    if (!token.access_token) throw new Error();
    const profile = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { authorization: `Bearer ${token.access_token}` } }).then(r => r.json());
    const email = profile.mail || profile.userPrincipalName;
    db.prepare(`INSERT INTO connected_accounts (user_id,provider,email,access_token,refresh_token,expires_at,status) VALUES (?,?,?,?,?,?, 'connected')
      ON CONFLICT(user_id,provider) DO UPDATE SET email=excluded.email,access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,status='connected'`)
      .run(jwt.id, 'microsoft', email, token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000);
    log(jwt.id, 'account', `Connected Outlook ${email}`); res.redirect('/#settings?connected=1');
  } catch { res.redirect('/#settings?oauthError=1'); }
});
app.delete('/api/accounts/:id', (req, res) => { db.prepare("UPDATE connected_accounts SET status='disconnected',access_token=NULL WHERE id=? AND user_id=?").run(req.params.id, req.user.id); res.json({ ok: true }); });

app.use(express.static(path.join(__dirname, '..')));
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});
app.listen(port, () => console.log(`Email Studio running at ${appUrl}`));

module.exports = app;
