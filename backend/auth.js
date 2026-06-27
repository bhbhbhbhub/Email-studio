const jwt = require('jsonwebtoken');

const secret = () => process.env.JWT_SECRET || 'development-only-change-me';
function sign(user) {
  return jwt.sign({ id: user.id, email: user.email }, secret(), { expiresIn: '7d' });
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
}
module.exports = { sign, auth };
