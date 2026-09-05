export function enhanceCommercialPanel(response: Response): Response {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('text/html')) return response;

    const script = `<script>
(function(){
    'use strict';
    const GB = 1073741824;
    const $ = (id) => document.getElementById(id);

    function esc(value) {
        return String(value ?? '').replace(/[&<>\"']/g, (c) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '\"': '&quot;',
            "'": '&#39;'
        }[c]));
    }

    function ensureUserControls() {
        const usersTab = document.getElementById('tab-users');
        if (!usersTab) return false;

        const username = $('addUserUsername');
        const days = $('addUserDays');
        const note = $('addUserNote');
        if (username && days && note && !$('addUserQuota')) {
            const anchor = note.closest('.form-group') || note.parentElement;
            if (anchor) {
                anchor.insertAdjacentHTML('afterend',
                    '<div class="form-group" id="commercial-user-options">' +
                    '<label class="form-label">Traffic Quota (GB)</label>' +
                    '<input class="neon-input" type="number" id="addUserQuota" value="0" min="0" step="0.01" title="0 = unlimited">' +
                    '<label class="form-label" style="margin-top:12px;">Devices</label>' +
                    '<select class="neon-input" id="addUserConnections">' +
                    '<option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>' +
                    '</select>' +
                    '<label class="form-label" style="margin-top:12px;">Plan preset</label>' +
                    '<select class="neon-input" id="addUserPlan">' +
                    '<option value="custom">Custom</option>' +
                    '<option value="30-unlimited">30 days • Unlimited</option>' +
                    '<option value="30-100">30 days • 100 GB</option>' +
                    '<option value="30-50">30 days • 50 GB</option>' +
                    '</select></div>'
                );
            }
        }

        const plan = $('addUserPlan');
        if (plan && !plan.dataset.commercialBound) {
            plan.dataset.commercialBound = '1';
            plan.addEventListener('change', function(){
                if (this.value === '30-unlimited') { if ($('addUserDays')) $('addUserDays').value = 30; if ($('addUserQuota')) $('addUserQuota').value = 0; }
                if (this.value === '30-100') { if ($('addUserDays')) $('addUserDays').value = 30; if ($('addUserQuota')) $('addUserQuota').value = 100; }
                if (this.value === '30-50') { if ($('addUserDays')) $('addUserDays').value = 30; if ($('addUserQuota')) $('addUserQuota').value = 50; }
            });
        }

        const modal = $('userEditModal');
        if (modal && !$('editUserQuota')) {
            const noteField = $('editUserNote');
            const anchor = noteField && (noteField.closest('.form-group') || noteField.parentElement);
            if (anchor) {
                anchor.insertAdjacentHTML('afterend',
                    '<div class="form-group" id="commercial-edit-options">' +
                    '<label class="form-label">Traffic Quota (GB)</label>' +
                    '<input class="neon-input" type="number" id="editUserQuota" min="0" step="0.01" title="0 = unlimited">' +
                    '<label class="form-label" style="margin-top:12px;">Devices</label>' +
                    '<select class="neon-input" id="editUserConnections">' +
                    '<option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>' +
                    '</select>' +
                    '</div>' +
                    '<label class="toggle-label"><input type="checkbox" id="editUserResetUsage"><span class="toggle-switch"></span> Reset traffic usage</label>'
                );
            }
        }

        const table = usersTab.querySelector('table');
        if (table) {
            const head = table.querySelector('thead tr');
            if (head && !head.querySelector('[data-commercial-col="traffic"]')) {
                head.insertAdjacentHTML('beforeend', '<th data-commercial-col="traffic">Traffic</th><th data-commercial-col="devices">Devices</th>');
            }
        }
        return true;
    }

    function renderCommercialUsers(users) {
        const tbody = $('users-tbody');
        if (!tbody) return false;
        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-sm" style="text-align:center;padding:24px;">No users found.</td></tr>';
            return true;
        }
        tbody.innerHTML = users.map((u) => {
            const url = window.location.origin + '/sub/user/' + encodeURIComponent(u.subPath || '');
            const quota = Number(u.quotaGb || 0) > 0 ? Number(u.quotaGb).toFixed(2) + ' GB' : 'Unlimited';
            const used = Number(u.usedGb || 0).toFixed(2) + ' GB';
            let state = '<span style="color:green;">✅ Active</span>';
            if (!u.active) state = '<span style="color:gray;">⏸ Disabled</span>';
            else if (new Date(u.expiresAt) < new Date()) state = '<span style="color:red;">❌ Expired</span>';
            else if (Number(u.quotaBytes || 0) > 0 && Number(u.usedBytes || 0) >= Number(u.quotaBytes)) state = '<span style="color:#f59e0b;">🚫 Quota</span>';
            return '<tr>' +
                '<td><b>' + esc(u.username) + '</b></td>' +
                '<td>' + new Date(u.expiresAt).toLocaleDateString() + '</td>' +
                '<td>' + state + '</td>' +
                '<td>' + esc(u.note || '-') + '</td>' +
                '<td>' + used + ' / ' + quota + '</td>' +
                '<td>' + Number(u.activeSessions || 0) + ' / ' + Number(u.maxConnections || 1) + '</td>' +
                '<td class="actions-cell">' +
                '<button class="action-btn" title="Copy subscription URL" onclick="copyUserSub(\'' + esc(url) + '\')">📋</button>' +
                '<button class="action-btn" title="Edit user" onclick="openUserEdit(\'' + esc(u.username) + '\')">✏️</button>' +
                '<button class="action-btn danger" title="Delete user" onclick="deleteUser(\'' + esc(u.username) + '\')">🗑️</button>' +
                '</td></tr>';
        }).join('');
        return true;
    }

    async function loadCommercialUsers() {
        try {
            const response = await fetch('/panel/users', { credentials: 'include', cache: 'no-store' });
            const data = await response.json();
            if (data.success) {
                ensureUserControls();
                renderCommercialUsers(data.body || []);
            }
        } catch (error) {
            console.error('Commercial users load error:', error);
        }
    }

    function installUserActions() {
        if (typeof window.addUser === 'function' && !window.addUser.__commercialWrapped) {
            const original = window.addUser;
            const wrapped = async function(){ return original.apply(this, arguments); };
            wrapped.__commercialWrapped = true;
            window.addUser = async function(){
                const username = $('addUserUsername')?.value.trim() || '';
                const days = parseInt($('addUserDays')?.value || '30', 10) || 30;
                const note = $('addUserNote')?.value.trim() || '';
                const quotaGb = parseFloat($('addUserQuota')?.value || '0') || 0;
                const maxConnections = parseInt($('addUserConnections')?.value || '1', 10) || 1;
                if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) { showToast('Invalid username.','error'); return; }
                if (quotaGb < 0 || maxConnections < 1 || maxConnections > 5) { showToast('Invalid quota or device limit.','error'); return; }
                try {
                    document.body.style.cursor = 'wait';
                    const r = await fetch('/panel/users', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,days,note,quotaGb,maxConnections}) });
                    const d = await r.json();
                    if (!d.success) { showToast(d.message || 'Failed to create user.','error'); return; }
                    if ($('addUserUsername')) $('addUserUsername').value = '';
                    if ($('addUserNote')) $('addUserNote').value = '';
                    showToast('User created.','success');
                    await loadCommercialUsers();
                } catch (e) { showToast('Failed to create user.','error'); }
                finally { document.body.style.cursor = 'default'; }
            };
        }
    }

    function installEditAction() {
        window.openUserEdit = async function(username){
            window.editingUsername = username;
            try {
                document.body.style.cursor = 'wait';
                const r = await fetch('/panel/users/' + encodeURIComponent(username), { credentials:'include', cache:'no-store' });
                const d = await r.json();
                if (!d.success) { showToast('User not found.','error'); return; }
                const u = d.body;
                ensureUserControls();
                $('editUserUsername').textContent = u.username;
                $('editUserDays').value = 0;
                $('editUserNote').value = u.note || '';
                $('editUserActive').value = u.active ? 'true' : 'false';
                $('editUserQuota').value = u.quotaGb || 0;
                $('editUserConnections').value = u.maxConnections || 1;
                $('editUserResetUsage').checked = false;
                $('userEditModal').style.display = 'flex';
                document.body.style.overflow = 'hidden';
            } catch (e) { showToast('Failed to load user.','error'); }
            finally { document.body.style.cursor = 'default'; }
        };
        window.saveUserEdit = async function(){
            if (!window.editingUsername) return;
            const days = parseInt($('editUserDays')?.value || '0', 10) || 0;
            const note = $('editUserNote')?.value.trim() || '';
            const active = $('editUserActive')?.value === 'true';
            const quotaGb = parseFloat($('editUserQuota')?.value || '0') || 0;
            const maxConnections = parseInt($('editUserConnections')?.value || '1', 10) || 1;
            const resetUsage = !!$('editUserResetUsage')?.checked;
            try {
                document.body.style.cursor = 'wait';
                const r = await fetch('/panel/users/' + encodeURIComponent(window.editingUsername), { method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({days,note,active,quotaGb,maxConnections,resetUsage}) });
                const d = await r.json();
                if (!d.success) { showToast(d.message || 'Failed to update user.','error'); return; }
                showToast('User updated.','success');
                if (typeof closeUserEdit === 'function') closeUserEdit();
                await loadCommercialUsers();
            } catch (e) { showToast('Failed to update user.','error'); }
            finally { document.body.style.cursor = 'default'; }
        };
    }

    function installExternalUi() {
        if ($('externalConfigFab')) return;
        const fab = document.createElement('button');
        fab.id = 'externalConfigFab';
        fab.textContent = '⚡ Config Sources';
        fab.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;padding:10px 14px;border:1px solid currentColor;border-radius:8px;background:rgba(0,0,0,.75);color:inherit;cursor:pointer';
        document.body.appendChild(fab);
        const box = document.createElement('div');
        box.id = 'externalConfigBox';
        box.style.cssText = 'display:none;position:fixed;right:18px;bottom:64px;width:min(760px,calc(100vw - 36px));max-height:75vh;overflow:auto;z-index:9998;padding:18px;border-radius:12px;background:var(--bg-secondary,#111);border:1px solid currentColor';
        box.innerHTML = '<h3>External Config Sources</h3><p class="text-muted text-sm">Manage public HTTPS subscription sources, priority and health.</p><div style="display:grid;grid-template-columns:1fr 2fr 90px 1fr auto;gap:8px;margin:12px 0"><input class="neon-input" id="extName" placeholder="Name"><input class="neon-input" id="extUrl" placeholder="https://example.com/sub"><input class="neon-input" id="extPriority" type="number" value="50" min="0" max="100"><input class="neon-input" id="extUser" placeholder="Username (optional)"><button class="action-btn" id="extAdd">Add</button></div><div id="extList">Loading…</div>';
        document.body.appendChild(box);
        async function loadExternal(){
            try {
                const r = await fetch('/panel/external-configs', {credentials:'include',cache:'no-store'}), d = await r.json();
                if (!d.success) { $('extList').textContent = d.message || 'Failed'; return; }
                $('extList').innerHTML = (d.body || []).map(x => '<div style="border-top:1px solid #444;padding:10px 0"><b>'+esc(x.name)+'</b> • '+(x.enabled?'Enabled':'Disabled')+' • priority '+x.priority+' • '+(x.lastLatencyMs ? x.lastLatencyMs+' ms' : 'not checked')+' • HTTP '+(x.lastStatus || '—')+'<br><small>'+esc(x.url)+'</small><br><button class="action-btn" data-check="'+esc(x.id)+'">Health check</button> <button class="action-btn" data-toggle="'+esc(x.id)+'">'+(x.enabled?'Disable':'Enable')+'</button> <button class="action-btn danger" data-delete="'+esc(x.id)+'">Delete</button> <a href="/sub/external/'+encodeURIComponent(x.id)+'" target="_blank" rel="noopener">Customer link</a></div>').join('') || '<p>No external sources.</p>';
                $('extList').querySelectorAll('[data-check]').forEach(b => b.onclick = async () => { const r=await fetch('/panel/external-configs/'+b.dataset.check+'/check',{method:'POST',credentials:'include'}); const d=await r.json(); showToast(d.message || (d.success?'Healthy':'Failed'),d.success?'success':'error'); loadExternal(); });
                $('extList').querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => { const current=(d.body||[]).find(x=>x.id===b.dataset.toggle); if(!current)return; await fetch('/panel/external-configs/'+b.dataset.toggle,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:!current.enabled})}); loadExternal(); });
                $('extList').querySelectorAll('[data-delete]').forEach(b => b.onclick = async () => { if(!confirm('Delete this external source?'))return; await fetch('/panel/external-configs/'+b.dataset.delete,{method:'DELETE',credentials:'include'}); loadExternal(); });
            } catch (e) { if ($('extList')) $('extList').textContent = 'Failed to load sources.'; }
        }
        fab.onclick = () => { box.style.display = box.style.display === 'none' ? 'block' : 'none'; if (box.style.display === 'block') loadExternal(); };
        $('extAdd').onclick = async () => {
            const payload = {name:$('extName').value.trim(),url:$('extUrl').value.trim(),priority:Number($('extPriority').value||50),assignedUsername:$('extUser').value.trim()||undefined};
            const r = await fetch('/panel/external-configs',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}), d = await r.json();
            showToast(d.message || 'Done', d.success ? 'success' : 'error'); if(d.success){$('extName').value='';$('extUrl').value='';$('extUser').value='';loadExternal();}
        };
    }

    function boot() {
        if (window.__commercialPanelBooted) return;
        window.__commercialPanelBooted = true;
        let attempts = 0;
        const run = () => {
            ensureUserControls();
            installUserActions();
            installEditAction();
            installExternalUi();
            if ($('users-tbody')) loadCommercialUsers();
            if (++attempts < 20 && !$('addUserQuota')) setTimeout(run, 250);
        };
        run();
        const observer = new MutationObserver(() => { ensureUserControls(); });
        observer.observe(document.body, {childList:true,subtree:true});
        setTimeout(() => observer.disconnect(), 15000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
    else boot();
})();
</script>`;

    return new HTMLRewriter()
        .on('head', { element(element) { element.append(script, { html: true }); } })
        .transform(response);
}
