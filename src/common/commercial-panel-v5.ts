import { enhanceCommercialPanel as enhanceCommercialPanelV4 } from '@common/commercial-panel-v4';

export function enhanceCommercialPanel(response: Response): Response {
    const base = enhanceCommercialPanelV4(response);
    const patch = `<script>
(function(){
'use strict';
function patchSave(){
    if (typeof window.saveUserEdit !== 'function' || window.saveUserEdit.__zeroDaysFixed) return;
    const original = window.saveUserEdit;
    // The base editor uses 0 to mean "no expiry extension". The API correctly
    // rejects days=0, so intercept the request and omit days when it is zero.
    window.saveUserEdit = async function(){
        if (!window.editingUsername) return;
        const $ = (id) => document.getElementById(id);
        const days = parseInt($('editUserDays')?.value || '0', 10) || 0;
        if (days > 0) return original.apply(this, arguments);
        const note = $('editUserNote')?.value.trim() || '';
        const active = $('editUserActive')?.value === 'true';
        const quotaGb = parseFloat($('editUserQuota')?.value || '0') || 0;
        const maxConnections = parseInt($('editUserConnections')?.value || '1', 10) || 1;
        const resetUsage = !!$('editUserResetUsage')?.checked;
        const resetState = !!$('editUserResetState')?.checked;
        try {
            const r = await fetch('/panel/users/' + encodeURIComponent(window.editingUsername), {
                method:'PUT', credentials:'include', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({note, active, quotaGb, maxConnections, resetUsage, resetState})
            });
            const d = await r.json();
            if (!d.success) { showToast(d.message || 'Failed to update user.','error'); return; }
            showToast('User updated.','success');
            if (typeof closeUserEdit === 'function') closeUserEdit();
            if (typeof window.loadUsers === 'function') await window.loadUsers();
        } catch(e) { showToast('Failed to update user.','error'); }
    };
    window.saveUserEdit.__zeroDaysFixed = true;
}
function boot(){
    patchSave();
    const observer = new MutationObserver(patchSave);
    if (document.body) observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),15000);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
</script>`;
    return new HTMLRewriter().on('body',{element(element){element.append(patch,{html:true});}}).transform(base);
}
