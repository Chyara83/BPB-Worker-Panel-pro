export function enhanceCommercialPanel(response: Response): Response {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) return response;

    const script = `<script>
(function(){
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

function ensureUserControls(){
    const tab = $('tab-users');
    if (!tab) return false;
    const username = $('addUserUsername'), days = $('addUserDays'), note = $('addUserNote');
    if (username && days && note && !$('addUserQuota')) {
        const anchor = note.closest('.form-group') || note.parentElement;
        if (anchor) anchor.insertAdjacentHTML('afterend',
            '<div class="form-group" id="commercial-user-options">' +
            '<label class="form-label">Traffic Quota (GB)</label>' +
            '<input class="neon-input" type="number" id="addUserQuota" value="0" min="0" step="0.01" title="0 = unlimited">' +
            '<label class="form-label" style="margin-top:12px;">Devices</label>' +
            '<select class="neon-input" id="addUserConnections"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select>' +
            '<label class="form-label" style="margin-top:12px;">Plan preset</label>' +
            '<select class="neon-input" id="addUserPlan"><option value="custom">Custom</option><option value="30-unlimited">30 days • Unlimited</option><option value="30-100">30 days • 100 GB</option><option value="30-50">30 days • 50 GB</option></select>' +
            '</div>');
    }
    const plan = $('addUserPlan');
    if (plan && !plan.dataset.commercialBound) {
        plan.dataset.commercialBound = '1';
        plan.addEventListener('change', function(){
            const presets = {'30-unlimited':[30,0],'30-100':[30,100],'30-50':[30,50]};
            const p = presets[this.value];
            if (p) { if ($('addUserDays')) $('addUserDays').value=p[0]; if ($('addUserQuota')) $('addUserQuota').value=p[1]; }
        });
    }
    const modal = $('userEditModal');
    if (modal && !$('editUserQuota')) {
        const noteField = $('editUserNote');
        const anchor = noteField && (noteField.closest('.form-group') || noteField.parentElement);
        if (anchor) anchor.insertAdjacentHTML('afterend',
            '<div class="form-group" id="commercial-edit-options">' +
            '<label class="form-label">Traffic Quota (GB)</label><input class="neon-input" type="number" id="editUserQuota" min="0" step="0.01" title="0 = unlimited">' +
            '<label class="form-label" style="margin-top:12px;">Devices</label><select class="neon-input" id="editUserConnections"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></div>' +
            '<label class="toggle-label"><input type="checkbox" id="editUserResetUsage"><span class="toggle-switch"></span> Reset traffic usage</label>');
    }
    const table = tab.querySelector('table');
    const head = table && table.querySelector('thead tr');
    if (head && !head.querySelector('[data-commercial-col="traffic"]')) head.insertAdjacentHTML('beforeend','<th data-commercial-col="traffic">Traffic</th><th data-commercial-col="devices">Devices</th>');
    return true;
}

function renderUsers(users){
    const tbody = $('users-tbody');
    if (!tbody) return false;
    if (!users.length) { tbody.innerHTML='<tr><td colspan="7" class="text-muted text-sm" style="text-align:center;padding:24px;">No users found.</td></tr>'; return true; }
    tbody.innerHTML = users.map(u => {
        const url = window.location.origin + '/sub/user/' + encodeURIComponent(u.subPath || '');
        const quota = Number(u.quotaGb || 0) > 0 ? Number(u.quotaGb).toFixed(2)+' GB' : 'Unlimited';
        const used = Number(u.usedGb || 0).toFixed(2)+' GB';
        let state='<span style="color:green;">✅ Active</span>';
        if (!u.active) state='<span style="color:gray;">⏸ Disabled</span>';
        else if (new Date(u.expiresAt) < new Date()) state='<span style="color:red;">❌ Expired</span>';
        else if (Number(u.quotaBytes||0)>0 && Number(u.usedBytes||0)>=Number(u.quotaBytes)) state='<span style="color:#f59e0b;">🚫 Quota</span>';
        return '<tr><td><b>'+esc(u.username)+'</b></td><td>'+new Date(u.expiresAt).toLocaleDateString()+'</td><td>'+state+'</td><td>'+esc(u.note||'-')+'</td><td>'+used+' / '+quota+'</td><td>'+Number(u.activeSessions||0)+' / '+Number(u.maxConnections||1)+'</td><td class="actions-cell">' +
            '<button class="action-btn" title="Copy subscription URL" data-copy-sub="'+esc(url)+'">📋</button>' +
            '<button class="action-btn" title="Edit user" data-edit-user="'+esc(u.username)+'">✏️</button>' +
            '<button class="action-btn danger" title="Delete user" data-delete-user="'+esc(u.username)+'">🗑️</button></td></tr>';
    }).join('');
    tbody.querySelectorAll('[data-copy-sub]').forEach(b => b.onclick=async()=>{ try { await navigator.clipboard.writeText(b.dataset.copySub); showToast('Subscription URL copied.','success'); } catch(e){ prompt('Subscription URL',b.dataset.copySub); } });
    tbody.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>window.openUserEdit(b.dataset.editUser));
    tbody.querySelectorAll('[data-delete-user]').forEach(b=>b.onclick=()=>window.deleteUser(b.dataset.deleteUser));
    return true;
}

async function loadUsers(){
    try { const r=await fetch('/panel/users',{credentials:'include',cache:'no-store'}); const d=await r.json(); if(d.success){ensureUserControls();renderUsers(d.body||[]);} }
    catch(e){console.error('Commercial users load error:',e);}
}

function installActions(){
    window.addUser = async function(){
        const username=$('addUserUsername')?.value.trim()||'';
        const days=parseInt($('addUserDays')?.value||'30',10)||30;
        const note=$('addUserNote')?.value.trim()||'';
        const quotaGb=parseFloat($('addUserQuota')?.value||'0')||0;
        const maxConnections=parseInt($('addUserConnections')?.value||'1',10)||1;
        if(!/^[a-zA-Z0-9_]{3,20}$/.test(username)){showToast('Invalid username.','error');return;}
        if(quotaGb<0||maxConnections<1||maxConnections>5){showToast('Invalid quota or device limit.','error');return;}
        try{const r=await fetch('/panel/users',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,days,note,quotaGb,maxConnections})});const d=await r.json();if(!d.success){showToast(d.message||'Failed to create user.','error');return;} $('addUserUsername').value='';$('addUserNote').value='';showToast('User created.','success');await loadUsers();}catch(e){showToast('Failed to create user.','error');}
    };
    window.openUserEdit = async function(username){
        window.editingUsername=username;
        try{const r=await fetch('/panel/users/'+encodeURIComponent(username),{credentials:'include',cache:'no-store'});const d=await r.json();if(!d.success){showToast('User not found.','error');return;}const u=d.body;ensureUserControls();$('editUserUsername').textContent=u.username;$('editUserDays').value=0;$('editUserNote').value=u.note||'';$('editUserActive').value=u.active?'true':'false';$('editUserQuota').value=u.quotaGb||0;$('editUserConnections').value=u.maxConnections||1;$('editUserResetUsage').checked=false;$('userEditModal').style.display='flex';document.body.style.overflow='hidden';}catch(e){showToast('Failed to load user.','error');}
    };
    window.saveUserEdit = async function(){
        if(!window.editingUsername)return;
        const days=parseInt($('editUserDays')?.value||'0',10)||0,note=$('editUserNote')?.value.trim()||'',active=$('editUserActive')?.value==='true',quotaGb=parseFloat($('editUserQuota')?.value||'0')||0,maxConnections=parseInt($('editUserConnections')?.value||'1',10)||1,resetUsage=!!$('editUserResetUsage')?.checked;
        try{const r=await fetch('/panel/users/'+encodeURIComponent(window.editingUsername),{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({days,note,active,quotaGb,maxConnections,resetUsage})});const d=await r.json();if(!d.success){showToast(d.message||'Failed to update user.','error');return;}showToast('User updated.','success');if(typeof closeUserEdit==='function')closeUserEdit();await loadUsers();}catch(e){showToast('Failed to update user.','error');}
    };
}

function installExternalUi(){
    if($('externalConfigFab'))return;
    const fab=document.createElement('button');fab.id='externalConfigFab';fab.textContent='⚡ Config Sources';fab.style.cssText='position:fixed;right:18px;bottom:18px;z-index:9999;padding:10px 14px;border:1px solid currentColor;border-radius:8px;background:rgba(0,0,0,.75);color:inherit;cursor:pointer';document.body.appendChild(fab);
    const box=document.createElement('div');box.id='externalConfigBox';box.style.cssText='display:none;position:fixed;right:18px;bottom:64px;width:min(760px,calc(100vw - 36px));max-height:75vh;overflow:auto;z-index:9998;padding:18px;border-radius:12px;background:var(--bg-secondary,#111);border:1px solid currentColor';box.innerHTML='<h3>External Config Sources</h3><p class="text-muted text-sm">Manage public HTTPS subscription sources, priority and health.</p><div style="display:grid;grid-template-columns:1fr 2fr 90px 1fr auto;gap:8px;margin:12px 0"><input class="neon-input" id="extName" placeholder="Name"><input class="neon-input" id="extUrl" placeholder="https://example.com/sub"><input class="neon-input" id="extPriority" type="number" value="50" min="0" max="100"><input class="neon-input" id="extUser" placeholder="Username (optional)"><button class="action-btn" id="extAdd">Add</button></div><div id="extList">Loading…</div>';document.body.appendChild(box);
    async function loadExternal(){try{const r=await fetch('/panel/external-configs',{credentials:'include',cache:'no-store'}),d=await r.json();if(!d.success){$('extList').textContent=d.message||'Failed';return;}$('extList').innerHTML=(d.body||[]).map(x=>'<div style="border-top:1px solid #444;padding:10px 0"><b>'+esc(x.name)+'</b> • '+(x.enabled?'Enabled':'Disabled')+' • priority '+x.priority+' • '+(x.lastLatencyMs?x.lastLatencyMs+' ms':'not checked')+' • HTTP '+(x.lastStatus||'—')+'<br><small>'+esc(x.url)+'</small><br><button class="action-btn" data-check="'+esc(x.id)+'">Health check</button> <button class="action-btn" data-toggle="'+esc(x.id)+'">'+(x.enabled?'Disable':'Enable')+'</button> <button class="action-btn danger" data-del="'+esc(x.id)+'">Delete</button> <a href="/sub/external/'+encodeURIComponent(x.id)+'" target="_blank" rel="noopener">Customer link</a></div>').join('')||'<p>No external sources.</p>';document.querySelectorAll('#extList [data-check]').forEach(b=>b.onclick=async()=>{const r=await fetch('/panel/external-configs/'+b.dataset.check+'/check',{method:'POST',credentials:'include'}),d=await r.json();showToast(d.message||(d.success?'Healthy':'Failed'),d.success?'success':'error');loadExternal();});document.querySelectorAll('#extList [data-toggle]').forEach(b=>b.onclick=async()=>{const c=(d.body||[]).find(x=>x.id===b.dataset.toggle);if(!c)return;await fetch('/panel/external-configs/'+b.dataset.toggle,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!c.enabled})});loadExternal();});document.querySelectorAll('#extList [data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Delete this external source?'))return;await fetch('/panel/external-configs/'+b.dataset.del,{method:'DELETE',credentials:'include'});loadExternal();});}catch(e){if($('extList'))$('extList').textContent='Failed to load sources.';}}
    fab.onclick=()=>{box.style.display=box.style.display==='none'?'block':'none';if(box.style.display==='block')loadExternal();};
    $('extAdd').onclick=async()=>{const payload={name:$('extName').value.trim(),url:$('extUrl').value.trim(),priority:Number($('extPriority').value||50),assignedUsername:$('extUser').value.trim()||undefined};const r=await fetch('/panel/external-configs',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();showToast(d.message||'Done',d.success?'success':'error');if(d.success){$('extName').value='';$('extUrl').value='';$('extUser').value='';loadExternal();}};
}

function boot(){
    if(window.__commercialPanelBooted)return;
    window.__commercialPanelBooted=true;
    ensureUserControls();installActions();installExternalUi();loadUsers();
    const observer=new MutationObserver(()=>{ensureUserControls();});
    if(document.body)observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),15000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
</script>`;

    return new HTMLRewriter()
        .on('body', { element(element) { element.append(script, { html: true }); } })
        .transform(response);
}
