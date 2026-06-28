const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const state = { token: localStorage.getItem('emailStudioToken'), user: null, industries: [], templates: [], leads: [], dashboard: null, queueTimer: null };

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(`/api${url}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) logout();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(message, type = 'success') {
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message;
  $('#toast-root').appendChild(el); setTimeout(() => el.remove(), 3500);
}
function initials(name = '') { return name.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase() || 'ES'; }
function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date + (date.endsWith('Z') ? '' : 'Z'))) / 1000);
  if (seconds < 60) return 'Just now'; if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`; return `${Math.floor(seconds/86400)}d ago`;
}
function modal(content, large = false) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal ${large ? 'large' : ''}">${content}</div></div>`;
  $('.modal-backdrop').addEventListener('mousedown', e => { if (e.target === e.currentTarget) closeModal(); });
  $$('.modal-close').forEach(b => b.onclick = closeModal);
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function heading(title, desc, actions = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${desc}</p></div><div class="heading-actions">${actions}</div></div>`; }
function actionIcon(type) { return ({login:'↪',account:'●',import:'⇧',industry:'◇',template:'▤',generation:'✦',sent:'✓',failed:'!'}[type] || '•'); }
function logout() { localStorage.removeItem('emailStudioToken'); state.token = null; state.user = null; location.hash = ''; $('#app-shell').classList.add('hidden'); $('#auth-screen').classList.remove('hidden'); }
function navigate(page) { location.hash = page; }

async function boot() {
  bindAuth();
  if (!state.token) return;
  try {
    state.user = await api('/me');
    $('#auth-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden');
    updateUserChrome(); await route();
  } catch { logout(); }
}
function bindAuth() {
  $$('[data-auth]').forEach(b => b.onclick = () => {
    $$('.auth-form').forEach(f => f.classList.add('hidden')); $(`#${b.dataset.auth}-form`).classList.remove('hidden');
  });
  $$('.toggle-password').forEach(b => b.onclick = () => { const i = b.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; });
  $('#login-form').onsubmit = async e => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
    try { const data = await api('/auth/login', {method:'POST', body:JSON.stringify(body)}); authenticate(data); } catch(err){ toast(err.message,'error'); }
  };
  $('#register-form').onsubmit = async e => {
    e.preventDefault(); const body = Object.fromEntries(new FormData(e.target));
    try { const data = await api('/auth/register', {method:'POST', body:JSON.stringify(body)}); authenticate(data); } catch(err){ toast(err.message,'error'); }
  };
  $('#forgot-form').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); const data = await api('/auth/forgot',{method:'POST',body:JSON.stringify(body)}); toast(data.message); };
  $('#logout-btn').onclick = logout; $('#menu-button').onclick = () => $('.sidebar').classList.toggle('open');
  $('#refresh-button').onclick = route;
  $$('[data-nav]').forEach(b => b.onclick = () => navigate(b.dataset.nav));
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('#global-search').focus(); } if (e.key === 'Escape') closeModal(); });
  $('#global-search').addEventListener('keydown', e => { if (e.key === 'Enter') { navigate(`leads?search=${encodeURIComponent(e.target.value)}`); } });
}
function authenticate(data) {
  state.token = data.token; state.user = data.user; localStorage.setItem('emailStudioToken', data.token);
  $('#auth-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden'); updateUserChrome(); navigate('dashboard'); route();
}
function updateUserChrome() {
  $('#side-name').textContent = state.user.name; $('#side-email').textContent = state.user.email; $('#side-avatar').textContent = initials(state.user.name);
}
async function loadCommon() {
  [state.dashboard, state.industries, state.templates] = await Promise.all([api('/dashboard'), api('/industries'), api('/templates')]);
  $('#nav-lead-count').textContent = state.dashboard.stats.leads;
  $('#top-account').textContent = state.dashboard.account?.email || 'No email connected';
  $('.account-pill .status-dot').style.background = state.dashboard.account ? 'var(--green)' : 'var(--red)';
}
async function route() {
  if (!state.token) return;
  const routeName = (location.hash.slice(1).split('?')[0] || 'dashboard');
  $$('.sidebar nav a').forEach(a => a.classList.toggle('active', a.dataset.page === routeName));
  $('.sidebar').classList.remove('open'); $('#page').innerHTML = '<div class="empty"><div class="empty-icon">◌</div>Loading workspace...</div>';
  try {
    await loadCommon();
    const routes = { dashboard: renderDashboard, leads: renderLeads, industries: renderIndustries, templates: renderTemplates, generate: renderComposer, activity: renderActivity, settings: renderSettings };
    await (routes[routeName] || renderDashboard)();
  } catch(err) { $('#page').innerHTML = `<div class="empty"><h3>Could not load this page</h3><p>${escapeHtml(err.message)}</p></div>`; }
}

function renderDashboard() {
  const d = state.dashboard, cards = [
    ['♧',d.stats.leads,'Total leads','#a78bfa'],['◇',d.stats.industries,'Industries','#60a5fa'],['▤',d.stats.templates,'Templates','#c084fc'],
    ['◷',d.stats.pending,'Pending','#fbbf24'],['✓',d.stats.sent,'Sent','#36d399'],['!',d.stats.failed,'Failed','#fb7185']
  ];
  $('#page').innerHTML = heading(`Good ${new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, ${escapeHtml(state.user.name.split(' ')[0])}.`, 'Here’s what’s happening with your outreach.', `<button class="button primary" data-action="generate">✦ Compose emails</button>`) +
    `<section class="stats">${cards.map(c=>`<article class="stat-card" style="--tone:${c[3]};--glow:${c[3]}"><div class="stat-icon">${c[0]}</div><div class="stat-value">${c[1]}</div><div class="stat-label">${c[2]}</div></article>`).join('')}</section>
    <section class="dashboard-grid">
      <div>
        <article class="card">
          <div class="card-header"><div><h3>Quick actions</h3><p>Keep your outreach moving</p></div></div>
          <div class="quick-grid">
            <button class="quick-action" data-action="import"><span class="quick-icon">⇧</span><span><strong>Import leads</strong><small>CSV, Excel or shared sheet</small></span></button>
            <button class="quick-action" data-action="industry"><span class="quick-icon">◇</span><span><strong>New industry</strong><small>Organize your targeting</small></span></button>
            <button class="quick-action" data-action="template"><span class="quick-icon">▤</span><span><strong>Create template</strong><small>Build a reusable message</small></span></button>
            <button class="quick-action" data-action="generate"><span class="quick-icon">✦</span><span><strong>Generate emails</strong><small>Personalize for your leads</small></span></button>
          </div>
        </article>
        <article class="card" style="margin-top:16px"><div class="card-header"><h3>Email account</h3><button class="text-button" data-nav="settings">Manage</button></div>
          ${accountCard(d.account)}
        </article>
      </div>
      <article class="card"><div class="card-header"><h3>Recent activity</h3><button class="text-button" data-nav="activity">View all</button></div>
        <div class="timeline">${timeline(d.activity.slice(0,7))}</div>
      </article>
    </section>`;
  $$('[data-action]').forEach(b => b.onclick = () => ({import:openImport,industry:()=>openIndustry(),template:()=>openTemplate(),generate:()=>navigate('generate')}[b.dataset.action])());
  $$('[data-nav]').forEach(b => b.onclick = () => navigate(b.dataset.nav));
}
function accountCard(account) {
  return account ? `<div class="connected-card"><div class="provider"><span class="provider-logo">${account.provider==='google'?'G':'M'}</span><div><strong>${escapeHtml(account.email)}</strong><small>${account.provider==='google'?'GMAIL':'MICROSOFT OUTLOOK'} · CONNECTED</small></div></div><span class="badge Sent">Healthy</span></div>` :
  `<div class="connected-card disconnected"><div class="provider"><span class="provider-logo">✉</span><div><strong>No sending account</strong><small>CONNECT GMAIL OR OUTLOOK TO SEND</small></div></div><button class="button small primary" data-nav="settings">Connect</button></div>`;
}
function timeline(items) {
  if (!items.length) return '<div class="empty">No activity yet. Your workspace story starts here.</div>';
  return items.map(a=>`<div class="timeline-item"><span class="timeline-icon">${actionIcon(a.type)}</span><div><p>${escapeHtml(a.message)}</p><small>${timeAgo(a.created_at)}</small></div></div>`).join('');
}

async function renderLeads() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  state.leads = await api(`/leads?${params}`);
  $('#page').innerHTML = heading('Leads', 'Manage and organize everyone in your outreach pipeline.', `<button class="button ghost" id="import-btn">⇧ Import</button><button class="button primary" id="new-lead">＋ Add lead</button>`) +
    `<div class="toolbar"><div class="search-field"><input id="lead-search" placeholder="Search leads..." value="${escapeHtml(params.get('search')||'')}"></div>
      <select id="status-filter"><option value="">All statuses</option>${['Pending','Generated','Sending','Sent','Failed'].map(x=>`<option ${params.get('status')===x?'selected':''}>${x}</option>`)}</select>
      <select id="industry-filter"><option value="">All industries</option>${state.industries.map(i=>`<option value="${i.id}" ${params.get('industry')==i.id?'selected':''}>${escapeHtml(i.name)}</option>`)}</select>
      <select id="sort-filter"><option value="created">Newest first</option><option value="company">Company A–Z</option><option value="email">Email</option><option value="status">Status</option></select>
      <div class="selection-actions"><button class="button small ghost" id="generate-selected">✦ Generate selected</button><button class="button small danger" id="delete-selected">Delete</button></div></div>
    <div class="table-wrap">${state.leads.length ? `<table><thead><tr><th><input type="checkbox" id="select-all"></th><th>COMPANY</th><th>EMAIL</th><th>INDUSTRY</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>
    ${state.leads.map(l=>`<tr><td><input type="checkbox" class="lead-check" value="${l.id}"></td><td><div class="company-cell"><span class="company-logo">${escapeHtml(initials(l.company_name))}</span><div><strong>${escapeHtml(l.company_name)}</strong><small>${escapeHtml(l.website)}</small></div></div></td><td>${escapeHtml(l.email)}</td><td>${l.industry_name?`<span style="color:${l.industry_color}">●</span> ${escapeHtml(l.industry_name)}`:'—'}</td><td><span class="badge ${l.status}">${l.status}</span></td><td>${new Date(l.created_at+'Z').toLocaleDateString()}</td><td><div class="row-actions"><button class="icon-btn edit-lead" data-id="${l.id}">✎</button><button class="icon-btn delete-lead" data-id="${l.id}">×</button></div></td></tr>`).join('')}</tbody></table>`:'<div class="empty"><div class="empty-icon">♧</div><h3>No leads found</h3><p>Import a file or add your first lead manually.</p></div>'}</div>`;
  $('#import-btn').onclick = openImport; $('#new-lead').onclick = () => openLead();
  const applyFilters = () => { const p = new URLSearchParams(); if($('#lead-search').value)p.set('search',$('#lead-search').value); if($('#status-filter').value)p.set('status',$('#status-filter').value); if($('#industry-filter').value)p.set('industry',$('#industry-filter').value); p.set('sort',$('#sort-filter').value); location.hash=`leads?${p}`; };
  let searchTimer; $('#lead-search').oninput = () => { clearTimeout(searchTimer); searchTimer=setTimeout(applyFilters,350); }; $$('#status-filter,#industry-filter,#sort-filter').forEach(x=>x.onchange=applyFilters);
  if ($('#select-all')) $('#select-all').onchange = e => $$('.lead-check').forEach(x=>x.checked=e.target.checked);
  $$('.edit-lead').forEach(b=>b.onclick=()=>openLead(state.leads.find(l=>l.id==b.dataset.id)));
  $$('.delete-lead').forEach(b=>b.onclick=()=>deleteLead(b.dataset.id));
  $('#delete-selected').onclick=async()=>{ const ids=selectedIds(); if(!ids.length)return toast('Select at least one lead.','error'); if(!confirm(`Delete ${ids.length} leads?`))return; await Promise.all(ids.map(id=>api(`/leads/${id}`,{method:'DELETE'}))); toast('Leads deleted.'); route(); };
  $('#generate-selected').onclick=async()=>{ const ids=selectedIds(); if(!ids.length)return toast('Select at least one lead.','error'); const r=await api('/generate',{method:'POST',body:JSON.stringify({ids})}); toast(`Generated ${r.generated}; skipped ${r.skipped}.`); navigate('generate'); };
}
function selectedIds(){ return $$('.lead-check:checked').map(x=>Number(x.value)); }
function openLead(lead={}) {
  modal(`<form id="lead-form"><div class="modal-header"><div><h2>${lead.id?'Edit':'Add'} lead</h2><p>Keep the details useful for personalization.</p></div><button type="button" class="icon-btn modal-close">×</button></div>
  <div class="form-grid"><label>Company name<input name="company_name" required value="${escapeHtml(lead.company_name||'')}"></label><label>Email<input name="email" type="email" required value="${escapeHtml(lead.email||'')}"></label>
  <label>Website<input name="website" value="${escapeHtml(lead.website||'')}"></label><label>Industry<select name="industry_id"><option value="">Unassigned</option>${state.industries.map(i=>`<option value="${i.id}" ${lead.industry_id==i.id?'selected':''}>${escapeHtml(i.name)}</option>`)}</select></label>
  ${lead.id?`<label>Status<select name="status">${['Pending','Generated','Sending','Sent','Failed'].map(s=>`<option ${lead.status===s?'selected':''}>${s}</option>`)}</select></label>`:''}<label class="full">Notes<textarea name="notes" rows="4">${escapeHtml(lead.notes||'')}</textarea></label></div>
  <div class="modal-footer"><button type="button" class="button ghost modal-close">Cancel</button><button class="button primary">Save lead</button></div></form>`);
  $('#lead-form').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));await api(lead.id?`/leads/${lead.id}`:'/leads',{method:lead.id?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Lead saved.');route();};
}
async function deleteLead(id){if(!confirm('Delete this lead?'))return;await api(`/leads/${id}`,{method:'DELETE'});toast('Lead deleted.');route();}
function openImport(){
  modal(`<div class="modal-header"><div><h2>Import leads</h2><p>Bring your pipeline into Email Studio.</p></div><button class="icon-btn modal-close">×</button></div>
  <div class="import-tabs"><button class="active" data-tab="file">Upload file</button><button data-tab="link">Shared link</button></div>
  <form id="file-import"><label class="drop-zone" id="drop-zone"><input type="file" name="file" accept=".csv,.xlsx,.xls" required><div class="empty-icon">⇧</div><strong>Drop CSV or Excel here</strong><small>or click to browse · up to 10 MB</small><button type="button" class="button small ghost">Choose file</button></label><div id="file-name"></div><div class="modal-footer"><button type="button" class="button ghost modal-close">Cancel</button><button class="button primary">Import all rows</button></div></form>
  <form id="link-import" class="hidden stack"><label>Google Sheets or Excel Online link<input name="url" type="url" placeholder="https://docs.google.com/spreadsheets/d/..." required></label><p style="color:var(--muted);font-size:12px">The document must be accessible using its shared link.</p><div class="modal-footer"><button type="button" class="button ghost modal-close">Cancel</button><button class="button primary">Import sheet</button></div></form>`);
  $$('.import-tabs button').forEach(b=>b.onclick=()=>{$$('.import-tabs button').forEach(x=>x.classList.toggle('active',x===b));$('#file-import').classList.toggle('hidden',b.dataset.tab!=='file');$('#link-import').classList.toggle('hidden',b.dataset.tab!=='link');});
  const input=$('#file-import input'),zone=$('#drop-zone');zone.onclick=e=>{if(e.target.tagName!=='INPUT')input.click()};input.onchange=()=>$('#file-name').textContent=input.files[0]?.name||'';
  ['dragenter','dragover'].forEach(x=>zone.addEventListener(x,e=>{e.preventDefault();zone.classList.add('drag')}));['dragleave','drop'].forEach(x=>zone.addEventListener(x,e=>{e.preventDefault();zone.classList.remove('drag')}));zone.ondrop=e=>{input.files=e.dataTransfer.files;input.onchange()};
  $('#file-import').onsubmit=async e=>{e.preventDefault();try{const r=await api('/import/file',{method:'POST',body:new FormData(e.target)});closeModal();toast(`Imported ${r.imported} rows.`);navigate('leads');route();}catch(err){toast(err.message,'error')}};
  $('#link-import').onsubmit=async e=>{e.preventDefault();try{const r=await api('/import/link',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});closeModal();toast(`Imported ${r.imported} rows.`);navigate('leads');route();}catch(err){toast(err.message,'error')}};
}

function renderIndustries(){
  $('#page').innerHTML=heading('Industries','Create focused segments with their own default message.',`<button class="button primary" id="new-industry">＋ Add industry</button>`)+
  `<div class="toolbar"><input id="industry-search" placeholder="Search industries..." style="max-width:280px"></div><div class="industry-grid" id="industry-grid">${industryCards(state.industries)}</div>`;
  $('#new-industry').onclick=()=>openIndustry(); $('#industry-search').oninput=e=>$('#industry-grid').innerHTML=industryCards(state.industries.filter(i=>i.name.toLowerCase().includes(e.target.value.toLowerCase())));
  bindIndustryActions();
}
function industryCards(items){return items.length?items.map(i=>`<article class="industry-card" data-name="${escapeHtml(i.name)}"><div class="industry-top"><span class="industry-symbol" style="background:${i.color}20;color:${i.color}">${i.icon==='rocket'?'♜':i.icon==='heart'?'♥':'◇'}</span><div><button class="icon-btn edit-industry" data-id="${i.id}">✎</button><button class="icon-btn delete-industry" data-id="${i.id}">×</button></div></div><h3>${escapeHtml(i.name)}</h3><p>${i.template_id?'Default template ready':'Needs a default template'}</p><div class="industry-meta"><span>${i.lead_count} lead${i.lead_count===1?'':'s'}</span><span style="color:${i.template_id?'var(--green)':'var(--yellow)'}">${i.template_id?'● Ready':'○ Setup needed'}</span></div></article>`).join(''):'<div class="empty"><h3>No industries yet</h3><p>Create one to organize leads and attach a default template.</p></div>';}
function bindIndustryActions(){
  $$('.edit-industry').forEach(b=>b.onclick=()=>openIndustry(state.industries.find(i=>i.id==b.dataset.id)));
  $$('.delete-industry').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this industry? Leads will remain unassigned.'))return;await api(`/industries/${b.dataset.id}`,{method:'DELETE'});toast('Industry deleted.');route();});
}
function openIndustry(industry={}){
  modal(`<form id="industry-form"><div class="modal-header"><div><h2>${industry.id?'Edit':'New'} industry</h2><p>Give this segment a distinct visual identity.</p></div><button type="button" class="icon-btn modal-close">×</button></div><div class="form-grid">
  <label class="full">Industry name<input name="name" required value="${escapeHtml(industry.name||'')}" placeholder="e.g. Fintech"></label><label>Color<input name="color" type="color" value="${industry.color||'#8b5cf6'}" style="height:44px;padding:5px"></label><label>Icon<select name="icon"><option value="building">Building</option><option value="rocket">Rocket</option><option value="heart">Heart</option></select></label></div>
  <div class="modal-footer"><button type="button" class="button ghost modal-close">Cancel</button><button class="button primary">Save${industry.id?'':' & create template'}</button></div></form>`);
  $('#industry-form').onsubmit=async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.target));const saved=await api(industry.id?`/industries/${industry.id}`:'/industries',{method:industry.id?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Industry saved.');await loadCommon();if(!industry.id)openTemplate(null,saved.id);else route();};
}

function renderTemplates(){
  $('#page').innerHTML=heading('Email templates','Build reusable, personal messages for each industry.',`<button class="button primary" id="new-template">＋ New template</button>`)+
  `<div class="template-grid">${state.templates.length?state.templates.map(t=>`<article class="template-card"><div class="industry-top"><span class="badge" style="color:${t.industry_color||'#aaa'}">${escapeHtml(t.industry_name||'Unassigned')}</span>${t.is_default?'<span class="badge Sent">Default</span>':''}</div><h3>${escapeHtml(t.name)}</h3><p>Updated ${timeAgo(t.updated_at)}</p><div class="template-preview"><strong>${escapeHtml(t.subject)}</strong>${escapeHtml(t.body.slice(0,150))}</div><div class="card-actions"><button class="button small ghost edit-template" data-id="${t.id}">Edit</button><button class="button small ghost duplicate-template" data-id="${t.id}">Duplicate</button><button class="button small danger delete-template" data-id="${t.id}">Delete</button></div></article>`).join(''):'<div class="empty"><h3>No templates yet</h3><p>Create a default template for an industry to start generating.</p></div>'}</div>`;
  $('#new-template').onclick=()=>openTemplate(); $$('.edit-template').forEach(b=>b.onclick=()=>openTemplate(state.templates.find(t=>t.id==b.dataset.id)));
  $$('.duplicate-template').forEach(b=>b.onclick=async()=>{await api(`/templates/${b.dataset.id}/duplicate`,{method:'POST'});toast('Template duplicated.');route();});
  $$('.delete-template').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this template?'))return;await api(`/templates/${b.dataset.id}`,{method:'DELETE'});toast('Template deleted.');route();});
}
function openTemplate(template={},presetIndustry){
  template=template||{};
  modal(`<form id="template-form"><div class="modal-header"><div><h2>${template.id?'Edit':'Create'} template</h2><p>Use variables to personalize each message automatically.</p></div><button type="button" class="icon-btn modal-close">×</button></div><div class="stack">
  <label>Template name<input name="name" required value="${escapeHtml(template.name||'')}" placeholder="Partnership introduction"></label>
  <label>Industry<select name="industry_id" required><option value="">Select industry</option>${state.industries.map(i=>`<option value="${i.id}" ${(template.industry_id||presetIndustry)==i.id?'selected':''}>${escapeHtml(i.name)}</option>`)}</select></label>
  <label>Subject<input name="subject" id="template-subject" required value="${escapeHtml(template.subject||'A quick idea for {{company}}')}" placeholder="A quick idea for {{company}}"></label>
  <label>Body<textarea name="body" id="template-body" rows="12" required>${escapeHtml(template.body||'Hi {{company}} team,\\n\\nI came across {{website}} and wanted to reach out about a potential partnership in the {{industry}} space.\\n\\nWould you be open to a quick conversation?\\n\\nBest,\\n{{sender}}\\n{{signature}}')}</textarea></label>
  <div><small style="color:var(--muted)">INSERT VARIABLE</small><div class="variable-bar">${['company','website','industry','email','sender','signature'].map(v=>`<button type="button" class="variable" data-var="${v}">{{${v}}}</button>`).join('')}</div></div>
  <label class="check"><input name="is_default" type="checkbox" checked> Make this the default template for its industry</label></div>
  <div class="modal-footer"><button type="button" class="button ghost modal-close">Cancel</button><button type="button" class="button ghost" id="preview-template">Preview</button><button class="button primary">Save template</button></div></form>`,true);
  $$('.variable').forEach(b=>b.onclick=()=>{const el=$('#template-body');const start=el.selectionStart;el.value=el.value.slice(0,start)+`{{${b.dataset.var}}}`+el.value.slice(el.selectionEnd);el.focus();el.selectionStart=el.selectionEnd=start+b.dataset.var.length+4;});
  $('#preview-template').onclick=()=>toast('Preview this template with a real lead in Email Composer.');
  $('#template-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),body=Object.fromEntries(fd);body.is_default=fd.has('is_default');await api(template.id?`/templates/${template.id}`:'/templates',{method:template.id?'PUT':'POST',body:JSON.stringify(body)});closeModal();toast('Template saved.');navigate('templates');route();};
}

async function renderComposer(){
  state.leads=await api('/leads?sort=created');
  const generated=state.leads.filter(l=>l.generated_subject);
  $('#page').innerHTML=heading('Email Composer','Generate deterministic, personalized emails from your templates.',`<button class="button ghost" id="generate-emails">✦ Generate selected</button><button class="button primary" id="send-emails">Send selected</button>`)+
  `<div id="queue-area"></div><section class="composer"><article class="card lead-selector"><div class="card-header"><div><h3>Recipients</h3><p>${state.leads.length} leads</p></div><input type="checkbox" id="composer-all" style="width:auto"></div>
    ${state.leads.length?state.leads.map(l=>`<label class="lead-select-row"><input type="checkbox" class="compose-check" value="${l.id}" ${l.status==='Generated'?'checked':''}><span><strong>${escapeHtml(l.company_name)}</strong><small>${escapeHtml(l.email)} · ${l.status}</small></span></label>`).join(''):'<div class="empty">Add leads first.</div>'}</article>
    <article class="card preview-pane"><div class="card-header"><div><h3>Email preview</h3><p>Select a generated lead to inspect the message</p></div><button class="button small ghost" id="edit-generated">Edit</button></div><div id="email-preview">${generated.length?emailPreview(generated[0]):'<div class="empty"><div class="empty-icon">✦</div><h3>No generated email selected</h3><p>Select leads and click Generate selected.</p></div>'}</div></article></section>`;
  $('#composer-all').onchange=e=>$$('.compose-check').forEach(x=>x.checked=e.target.checked);
  $$('.lead-select-row').forEach(row=>row.onclick=()=>{const lead=state.leads.find(l=>l.id==$('.compose-check',row).value);if(lead?.generated_subject)$('#email-preview').innerHTML=emailPreview(lead)});
  $('#generate-emails').onclick=async()=>{const ids=$$('.compose-check:checked').map(x=>Number(x.value));try{const r=await api('/generate',{method:'POST',body:JSON.stringify({ids})});toast(`Generated ${r.generated} email${r.generated===1?'':'s'}${r.skipped?`; ${r.skipped} need templates`:''}.`);route();}catch(err){toast(err.message,'error')}};
  $('#send-emails').onclick=async()=>{const ids=$$('.compose-check:checked').map(x=>Number(x.value));try{await api('/send',{method:'POST',body:JSON.stringify({ids})});toast('Sending started.');monitorQueue();}catch(err){toast(err.message,'error')}};
  $('#edit-generated').onclick=()=>{const checked=$('.compose-check:checked');const lead=checked&&state.leads.find(l=>l.id==checked.value);if(!lead?.generated_subject)return toast('Select a generated email first.','error');openGeneratedEdit(lead)};
  monitorQueue();
}
function emailPreview(l){return `<div class="email-header"><span>To</span><strong>${escapeHtml(l.email)}</strong><span>Subject</span><strong>${escapeHtml(l.generated_subject)}</strong></div><div class="email-body">${escapeHtml(l.generated_body)}</div>`;}
function openGeneratedEdit(lead){
  modal(`<form id="generated-form"><div class="modal-header"><div><h2>Edit generated email</h2><p>Changes apply only to this recipient.</p></div><button type="button" class="icon-btn modal-close">×</button></div><div class="stack"><label>Subject<input name="generated_subject" value="${escapeHtml(lead.generated_subject)}"></label><label>Body<textarea name="generated_body" rows="15">${escapeHtml(lead.generated_body)}</textarea></label></div><div class="modal-footer"><button type="button" class="button ghost modal-close">Cancel</button><button class="button primary">Save changes</button></div></form>`,true);
  $('#generated-form').onsubmit=async e=>{e.preventDefault();const edits=Object.fromEntries(new FormData(e.target));await api(`/leads/${lead.id}`,{method:'PUT',body:JSON.stringify({...lead,...edits})});closeModal();toast('Email updated.');route();};
}
async function monitorQueue(){
  clearTimeout(state.queueTimer);let q;try{q=await api('/queue')}catch{return}const area=$('#queue-area');if(!area)return;if(q.status==='idle')return area.innerHTML='';
  const done=q.completed+q.failed,pct=q.total?Math.round(done/q.total*100):0;area.innerHTML=`<div class="progress-wrap"><div class="progress-top"><strong>${q.status==='complete'?'Sending complete':q.status==='paused'?'Sending paused':'Sending emails'}</strong><span>${done}/${q.total} · ${q.failed} failed</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="card-actions">${q.status==='running'?'<button class="button small ghost queue-action" data-action="pause">Pause</button>':''}${q.status==='paused'?'<button class="button small primary queue-action" data-action="resume">Resume</button>':''}${['running','paused'].includes(q.status)?'<button class="button small danger queue-action" data-action="cancel">Cancel</button>':''}</div></div>`;
  $$('.queue-action').forEach(b=>b.onclick=async()=>{await api(`/queue/${b.dataset.action}`,{method:'POST'});monitorQueue()});if(['running','paused'].includes(q.status))state.queueTimer=setTimeout(monitorQueue,1000);
}

function renderActivity(){
  $('#page').innerHTML=heading('Activity log','A clear audit trail of key workspace events.')+`<article class="card activity-list"><div class="timeline">${timeline(state.dashboard.activity)}</div></article>`;
}
async function renderSettings(){
  const settings=await api('/settings'),account=state.dashboard.account;
  $('#page').innerHTML=heading('Settings','Manage your profile, sending account, and workspace preferences.')+
  `<section class="settings-grid"><nav class="settings-nav"><button class="active" data-settings="profile">Profile</button><button data-settings="accounts">Email accounts</button><button data-settings="preferences">Preferences</button></nav>
  <div><div class="settings-section" id="settings-profile"><h3>Profile</h3><p style="color:var(--muted)">How you appear in generated outreach.</p><form id="profile-form" class="stack"><label>Full name<input name="name" value="${escapeHtml(state.user.name)}"></label><label>Company name<input name="company_name" value="${escapeHtml(state.user.company_name||'')}"></label><label>Email signature<textarea name="signature" rows="5">${escapeHtml(state.user.signature||'')}</textarea></label><div><button class="button primary">Save profile</button></div></form></div>
  <div class="settings-section hidden" id="settings-accounts"><h3>Connected email account</h3><p style="color:var(--muted)">Messages are sent directly from your selected inbox.</p>${account?accountCard(account)+`<button class="button danger" id="disconnect-account">Disconnect account</button>`:`<div class="oauth-grid"><article class="oauth-card"><span class="provider-logo">G</span><strong>Google Gmail</strong><p style="color:var(--muted)">Send securely through Gmail OAuth.</p><button class="button ghost oauth-connect" data-provider="google">Connect Gmail</button></article><article class="oauth-card"><span class="provider-logo">M</span><strong>Microsoft Outlook</strong><p style="color:var(--muted)">Send securely through Microsoft 365.</p><button class="button ghost oauth-connect" data-provider="microsoft">Connect Outlook</button></article></div>`}</div>
  <div class="settings-section hidden" id="settings-preferences"><h3>Preferences</h3><form id="settings-form" class="stack"><label>Theme<select name="theme"><option value="dark">Dark</option><option value="system" ${settings.theme==='system'?'selected':''}>Use system setting</option></select></label><label>Delay between emails (seconds)<input name="sending_delay" type="number" min="0" value="${settings.sending_delay}"></label><label class="check"><input name="notifications" type="checkbox" ${settings.notifications?'checked':''}> Enable notification updates</label><div><button class="button primary">Save preferences</button></div></form></div></div></section>`;
  $$('.settings-nav button').forEach(b=>b.onclick=()=>{$$('.settings-nav button').forEach(x=>x.classList.toggle('active',x===b));$$('.settings-section').forEach(s=>s.classList.toggle('hidden',s.id!==`settings-${b.dataset.settings}`))});
  $('#profile-form').onsubmit=async e=>{e.preventDefault();state.user=await api('/me',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});updateUserChrome();toast('Profile saved.')};
  $('#settings-form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),body=Object.fromEntries(fd);body.notifications=fd.has('notifications');await api('/settings',{method:'PUT',body:JSON.stringify(body)});toast('Preferences saved.')};
  $$('.oauth-connect').forEach(b=>b.onclick=async()=>{try{const r=await api(`/oauth/${b.dataset.provider}`);location.href=r.url}catch(err){toast(err.message,'error')}});
  if($('#disconnect-account'))$('#disconnect-account').onclick=async()=>{if(!confirm('Disconnect this sending account?'))return;await api(`/accounts/${account.id}`,{method:'DELETE'});toast('Account disconnected.');route()};
}
boot();
