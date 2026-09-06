/* Commercial panel UI v4 — compiled into panel HTML at build time. */
(function () {
    'use strict';

    const $ = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function ensureUserFields() {
        const addForm = document.querySelector('#tab-users .add-user-form');
        if (addForm && !$('addUserQuota')) {
            addForm.insertAdjacentHTML('beforeend',
                '<div class="form-group" style="margin:0"><label class="form-label">Traffic Quota (GB)</label>' +
                '<input class="neon-input" type="number" id="addUserQuota" value="0" min="0" step="0.01" title="0 = unlimited"></div>' +
                '<div class="form-group" style="margin:0"><label class="form-label">Devices</label>' +
                '<select class="neon-input" id="addUserConnections"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></div>'
            );
        }

        const note = $('editUserNote');
        if (note && !$('editUserQuota')) {
            note.parentElement.insertAdjacentHTML('afterend',
                '<div class="form-group"><label class="form-label">Traffic Quota (GB)</label>' +
                '<input class="neon-input" type="number" id="editUserQuota" value="0" min="0" step="0.01" title="0 = unlimited"></div>' +
                '<div class="form-group"><label class="form-label">Devices</label>' +
                '<select class="neon-input" id="editUserConnections"><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></div>' +
                '<label class="toggle-label"><input type="checkbox" id="editUserResetUsage"><span class="toggle-switch"></span> Reset traffic usage</label>' +
                '<label class="toggle-label"><input type="checkbox" id="editUserResetState"><span class="toggle-switch"></span> Reset active connections</label>'
            );
        }

        const header = document.querySelector('.users-table thead tr');
        if (header && !header.querySelector('[data-commercial-traffic]')) {
            const th1 = document.createElement('th');
            th1.textContent = 'Traffic';
            th1.dataset.commercialTraffic = '1';
            const th2 = document.createElement('th');
            th2.textContent = 'Devices';
            th2.dataset.commercialDevices = '1';
            header.insertBefore(th1, header.lastElementChild);
            header.insertBefore(th2, header.lastElementChild);
        }
    }

    function status(user) {
        if (!user.active) return '<span style="color:gray">⏸ Disabled</span>';
        if (new Date(user.expiresAt) < new Date()) return '<span style="color:red">❌ Expired</span>';
        if (Number(user.quotaBytes || 0) > 0 && Number(user.usedBytes || 0) >= Number(user.quotaBytes)) return '<span style="color:#f59e0b">🚫 Quota</span>';
        return '<span style="color:green">✅ Active</span>';
    }

    window.renderUsers = function (users) {
        ensureUserFields();
        const tbody = $('users-tbody');
        if (!tbody) return;
        if (!users.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-sm" style="text-align:center;padding:24px">No users found.</td></tr>';
            return;
        }
        tbody.innerHTML = users.map(user => {
            const quota = Number(user.quotaGb || 0) > 0 ? Number(user.quotaGb).toFixed(2) + ' GB' : 'Unlimited';
            const used = Number(user.usedGb || 0).toFixed(2) + ' GB';
            const devices = Number(user.activeSessions || 0) + ' / ' + Number(user.maxConnections || 1);
            const url = window.origin + '/sub/user/' + user.subPath;
            return '<tr>' +
                '<td><b>' + esc(user.username) + '</b></td>' +
                '<td>' + new Date(user.expiresAt).toLocaleDateString() + '</td>' +
                '<td>' + status(user) + '</td>' +
                '<td>' + esc(user.note || '-') + '</td>' +
                '<td>' + used + ' / ' + quota + '</td>' +
                '<td>' + devices + '</td>' +
                '<td class="actions-cell">' +
                '<button class="action-btn" title="Copy subscription URL" onclick="copyUserSub(\'' + esc(url) + '\')">📋</button>' +
                '<button class="action-btn" title="Edit user" onclick="openUserEdit(\'' + esc(user.username) + '\')">✏️</button>' +
                '<button class="action-btn danger" title="Delete user" onclick="deleteUser(\'' + esc(user.username) + '\')">🗑️</button>' +
                '</td></tr>';
        }).join('');
    };

    window.loadUsers = async function () {
        try {
            const response = await fetch('/panel/users', { credentials: 'include', cache: 'no-store' });
            const data = await response.json();
            if (!data.success) {
                showToast(data.message || 'Failed to load users.', 'error');
                return;
            }
            window.renderUsers(data.body || []);
        } catch (error) {
            console.error('Commercial users load error:', error);
            showToast('Failed to load users.', 'error');
        }
    };

    window.addUser = async function () {
        const username = $('addUserUsername')?.value.trim();
        const days = parseInt($('addUserDays')?.value, 10) || 30;
        const note = $('addUserNote')?.value.trim() || '';
        const quotaGb = parseFloat($('addUserQuota')?.value || 0);
        const maxConnections = parseInt($('addUserConnections')?.value || 1, 10);
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username || '')) return showToast('Invalid username.', 'error');
        if (quotaGb < 0 || maxConnections < 1 || maxConnections > 5) return showToast('Invalid quota or device limit.', 'error');
        try {
            const response = await fetch('/panel/users', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, days, note, quotaGb, maxConnections })
            });
            const data = await response.json();
            if (!data.success) return showToast(data.message || 'Failed to create user.', 'error');
            $('addUserUsername').value = '';
            $('addUserNote').value = '';
            $('addUserQuota').value = '0';
            $('addUserConnections').value = '1';
            showToast('User created.', 'success');
            await window.loadUsers();
        } catch (error) {
            console.error(error);
            showToast('Failed to create user.', 'error');
        }
    };

    window.openUserEdit = async function (username) {
        ensureUserFields();
        try {
            const response = await fetch('/panel/users/' + encodeURIComponent(username), { credentials: 'include', cache: 'no-store' });
            const data = await response.json();
            if (!data.success) return showToast(data.message || 'User not found.', 'error');
            const user = data.body || {};
            window.editingUsername = username;
            if ($('editUserUsername')) {
                $('editUserUsername').value = user.username || username;
                $('editUserUsername').textContent = user.username || username;
            }
            $('editUserDays').value = 0;
            $('editUserNote').value = user.note || '';
            $('editUserActive').value = user.active ? 'true' : 'false';
            $('editUserQuota').value = Number(user.quotaGb || 0);
            $('editUserConnections').value = Number(user.maxConnections || 1);
            $('editUserResetUsage').checked = false;
            $('editUserResetState').checked = false;
            $('userEditModal').style.display = 'flex';
            document.body.style.overflow = 'hidden';
        } catch (error) {
            console.error(error);
            showToast('Failed to load user.', 'error');
        }
    };

    window.saveUserEdit = async function () {
        const username = window.editingUsername;
        if (!username) return;
        const days = parseInt($('editUserDays').value, 10) || 0;
        const note = $('editUserNote').value.trim();
        const active = $('editUserActive').value === 'true';
        const quotaGb = parseFloat($('editUserQuota').value || 0);
        const maxConnections = parseInt($('editUserConnections').value || 1, 10);
        const resetUsage = $('editUserResetUsage').checked;
        const resetState = $('editUserResetState').checked;
        if (quotaGb < 0 || maxConnections < 1 || maxConnections > 5) return showToast('Invalid quota or device limit.', 'error');
        try {
            const response = await fetch('/panel/users/' + encodeURIComponent(username), {
                method: 'PUT', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days, note, active, quotaGb, maxConnections, resetUsage, resetState })
            });
            const data = await response.json();
            if (!data.success) return showToast(data.message || 'Failed to update user.', 'error');
            showToast('User updated.', 'success');
            if (typeof closeUserEdit === 'function') closeUserEdit();
            await window.loadUsers();
        } catch (error) {
            console.error(error);
            showToast('Failed to update user.', 'error');
        }
    };

    function installExternalConfigUI() {
        if ($('externalConfigFab')) return;
        const fab = document.createElement('button');
        fab.id = 'externalConfigFab';
        fab.textContent = '⚡ Config Sources';
        fab.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:9999;padding:10px 14px;border:1px solid currentColor;border-radius:8px;background:rgba(0,0,0,.75);color:inherit;cursor:pointer';
        document.body.appendChild(fab);
        const box = document.createElement('div');
        box.id = 'externalConfigBox';
        box.style.cssText = 'display:none;position:fixed;right:18px;bottom:64px;width:min(760px,calc(100vw - 36px));max-height:75vh;overflow:auto;z-index:9998;padding:18px;border-radius:12px;background:var(--bg-secondary,#111);border:1px solid currentColor';
        box.innerHTML = '<h3>External Config Sources</h3><p class="text-muted text-sm">Manage public HTTPS subscription sources, priority and health. A source can be assigned to a user and stops serving when that user expires or is disabled.</p>' +
            '<div style="display:grid;grid-template-columns:1fr 2fr 90px 1fr auto;gap:8px;margin:12px 0"><input class="neon-input" id="extName" placeholder="Name"><input class="neon-input" id="extUrl" placeholder="https://example.com/sub"><input class="neon-input" id="extPriority" type="number" value="50" min="0" max="100"><input class="neon-input" id="extUser" placeholder="Username (optional)"><button class="action-btn" id="extAdd">Add</button></div><div id="extList">Loading…</div>';
        document.body.appendChild(box);
        fab.onclick = () => { box.style.display = box.style.display === 'none' ? 'block' : 'none'; if (box.style.display === 'block') loadExternal(); };
        $('extAdd').onclick = async () => {
            const payload = { name: $('extName').value.trim(), url: $('extUrl').value.trim(), priority: Number($('extPriority').value || 50), assignedUsername: $('extUser').value.trim() || undefined };
            const response = await fetch('/panel/external-configs', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await response.json();
            showToast(data.message || 'Done', data.success ? 'success' : 'error');
            if (data.success) { $('extName').value = ''; $('extUrl').value = ''; $('extUser').value = ''; loadExternal(); }
        };
        async function loadExternal() {
            try {
                const response = await fetch('/panel/external-configs', { credentials: 'include', cache: 'no-store' });
                const data = await response.json();
                if (!data.success) { $('extList').textContent = data.message || 'Failed'; return; }
                $('extList').innerHTML = (data.body || []).map(item =>
                    '<div style="border-top:1px solid #444;padding:10px 0"><b>' + esc(item.name) + '</b> • ' + (item.enabled ? 'Enabled' : 'Disabled') + ' • priority ' + item.priority + ' • ' + (item.lastLatencyMs ? item.lastLatencyMs + ' ms' : 'not checked') + ' • HTTP ' + (item.lastStatus || '—') + '<br><small>' + esc(item.url) + '</small><br>' +
                    '<button class="action-btn" data-check="' + esc(item.id) + '">Health check</button> <button class="action-btn" data-toggle="' + esc(item.id) + '">' + (item.enabled ? 'Disable' : 'Enable') + '</button> <button class="action-btn danger" data-delete="' + esc(item.id) + '">Delete</button> <a href="/sub/external/' + encodeURIComponent(item.id) + '" target="_blank" rel="noopener">Customer link</a></div>'
                ).join('') || '<p>No external sources.</p>';
                $('extList').querySelectorAll('[data-check]').forEach(button => button.onclick = async () => { const r = await fetch('/panel/external-configs/' + button.dataset.check + '/check', { method: 'POST', credentials: 'include' }); const d = await r.json(); showToast(d.message || (d.success ? 'Healthy' : 'Failed'), d.success ? 'success' : 'error'); loadExternal(); });
                $('extList').querySelectorAll('[data-toggle]').forEach(button => button.onclick = async () => { const id = button.dataset.toggle; const current = (data.body || []).find(item => item.id === id); if (!current) return; await fetch('/panel/external-configs/' + id, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !current.enabled }) }); loadExternal(); });
                $('extList').querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => { if (!confirm('Delete this external source?')) return; await fetch('/panel/external-configs/' + button.dataset.delete, { method: 'DELETE', credentials: 'include' }); loadExternal(); });
            } catch (error) { console.error(error); }
        }
    }

    function boot() {
        ensureUserFields();
        installExternalConfigUI();
        window.loadUsers();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
