import { enhanceCommercialPanel as enhanceCommercialPanelV3 } from '@common/commercial-panel-v3';

export function enhanceCommercialPanel(response: Response): Response {
    const base = enhanceCommercialPanelV3(response);
    const patch = `<script>
(function(){
'use strict';
const $=(id)=>document.getElementById(id);
const esc=(v)=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

function ensureCommercialUserTable(){
    const tab=$('tab-users');
    if(!tab)return false;
    let table=tab.querySelector('table');
    if(table && table.querySelector('#users-tbody'))return true;
    const existing=tab.querySelector('[data-commercial-user-list]');
    if(existing)return true;
    const card=document.createElement('div');
    card.setAttribute('data-commercial-user-list','1');
    card.className='glass-card';
    card.innerHTML='<div class="glass-card-header"><div class="glass-card-title">👥 User List</div></div>'+
      '<div style="overflow-x:auto"><table style="width:100%;min-width:720px"><thead><tr><th>Username</th><th>Expires</th><th>Status</th><th>Note</th><th>Traffic</th><th>Devices</th><th>Actions</th></tr></thead><tbody id="users-tbody"><tr><td colspan="7" style="text-align:center;padding:24px">Loading users…</td></tr></tbody></table></div>';
    tab.appendChild(card);
    return true;
}

async function refreshCommercialTable(){
    try{
        if(!ensureCommercialUserTable())return;
        const r=await fetch('/panel/users',{credentials:'include',cache:'no-store'});
        const d=await r.json();
        const tbody=$('users-tbody');
        if(!tbody)return;
        if(!d.success){tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px">Unable to load users.</td></tr>';return;}
        const users=d.body||[];
        if(!users.length){tbody.innerHTML='<tr><td colspan="7" style="text-align:center;padding:24px">No users found.</td></tr>';return;}
        tbody.innerHTML=users.map(u=>{
            const quota=Number(u.quotaGb||0)>0?Number(u.quotaGb).toFixed(2)+' GB':'Unlimited';
            const used=Number(u.usedGb||0).toFixed(2)+' GB';
            let state='<span style="color:green">✅ Active</span>';
            if(!u.active)state='<span style="color:gray">⏸ Disabled</span>';
            else if(new Date(u.expiresAt)<new Date())state='<span style="color:red">❌ Expired</span>';
            else if(Number(u.quotaBytes||0)>0&&Number(u.usedBytes||0)>=Number(u.quotaBytes))state='<span style="color:#f59e0b">🚫 Quota</span>';
            const url=window.location.origin+'/sub/user/'+encodeURIComponent(u.subPath||'');
            return '<tr><td><b>'+esc(u.username)+'</b></td><td>'+new Date(u.expiresAt).toLocaleDateString()+'</td><td>'+state+'</td><td>'+esc(u.note||'-')+'</td><td>'+used+' / '+quota+'</td><td>'+Number(u.activeSessions||0)+' / '+Number(u.maxConnections||1)+'</td><td><button class="action-btn" title="Copy subscription URL" data-csub="'+esc(url)+'">📋</button> <button class="action-btn" title="Edit user" data-euser="'+esc(u.username)+'">✏️</button> <button class="action-btn danger" title="Delete user" data-duser="'+esc(u.username)+'">🗑️</button></td></tr>';
        }).join('');
        tbody.querySelectorAll('[data-csub]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.csub);showToast('Subscription URL copied.','success');}catch(e){prompt('Subscription URL',b.dataset.csub);}});
        tbody.querySelectorAll('[data-euser]').forEach(b=>b.onclick=()=>window.openUserEdit(b.dataset.euser));
        tbody.querySelectorAll('[data-duser]').forEach(b=>b.onclick=()=>window.deleteUser(b.dataset.duser));
    }catch(e){console.error('Commercial user table error:',e);}
}

function boot(){
    ensureCommercialUserTable();
    refreshCommercialTable();
    const observer=new MutationObserver(()=>{if(ensureCommercialUserTable())refreshCommercialTable();});
    if(document.body)observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),20000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
</script>`;
    return new HTMLRewriter().on('body',{element(element){element.append(patch,{html:true});}}).transform(base);
}
