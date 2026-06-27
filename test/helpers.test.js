const test = require('node:test');
const assert = require('node:assert/strict');
const { render, publicUser } = require('../backend/helpers');

test('template variables render from lead, industry, and user', () => {
  const result = render(
    'Hi {{company}} at {{website}} — {{industry}} / {{email}} / {{sender}} / {{signature}}',
    { company_name: 'Northstar', website: 'northstar.io', email: 'alex@northstar.io' },
    { name: 'Jordan', signature: 'Email Studio' },
    { name: 'Fintech' }
  );
  assert.equal(result, 'Hi Northstar at northstar.io — Fintech / alex@northstar.io / Jordan / Email Studio');
});

test('unknown variables are safely removed', () => {
  assert.equal(render('Hello {{unknown}}', {}, {}, null), 'Hello ');
});

test('public users never expose password hashes', () => {
  assert.deepEqual(publicUser({ id: 1, email: 'a@b.com', password_hash: 'secret' }), { id: 1, email: 'a@b.com' });
});
