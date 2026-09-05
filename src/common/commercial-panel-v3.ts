import { enhanceCommercialPanel as enhanceCommercialPanelV2 } from '@common/commercial-panel-v2';

export function enhanceCommercialPanel(response: Response): Response {
    const base = enhanceCommercialPanelV2(response);
    const patch = `<script>
(function(){
'use strict';
const $=(id)=>document.getElementById(id);
const esc=(v)=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));

async function refreshCommercialTable(){
    try{
        const r=await fetch('/panel/users',{credentials:'include',cache:'no-store'});
        const d=await r.json();
        if(!d.success)return;
        const tab=$('tab-users'),table=tab&&tab.querySelector('table'),tbody=$('users-tbody');
        if(!table||!tbody)return;
        const head=table.querySelector('thead tr');
        if(head&&!head.querySelector('[data-commercial-col="traffic"]'))head.insertAdjacentHTML('beforeend','<th data-commercial-col="traffic">Traffic</th><th data-commercial-col="devices">Devices</th>');
        const users=d.body||[];
        if(!users.length){tbody.innerHTML='<tr><td colspan="7" class="text-muted text-sm" style="text-align:center;padding:24px;">No users found.</td></tr>';return;}
        tbody.innerHTML=users.map(u=>{
            const quota=Number(u.quotaGb||0)>0?Number(u.quotaGb).toFixed(2)+' GB':'Unlimited';
            const used=Number(u.usedGb||0).toFixed(2)+' GB';
            let state='<span style="color:green;">✅ Active</span>';
            if(!u.active)state='<span style="color:gray;">⏸ Disabled</span>';
            else if(new Date(u.expiresAt)<new Date())state='<span style="color:red;">❌ Expired</span>';
            else if(Number(u.quotaBytes||0)>0&&Number(u.usedBytes||0)>=Number(u.quotaBytes))state='<span style="color:#f59e0b;">🚫 Quota</span>';
            const url=window.location.origin+'/sub/user/'+encodeURIComponent(u.subPath||'');
            return '<tr><td><b>'+esc(u.username)+'</b></td><td>'+new Date(u.expiresAt).toLocaleDateString()+'</td><td>'+state+'</td><td>'+esc(u.note||'-')+'</td><td>'+used+' / '+quota+'</td><td>'+Number(u.activeSessions||0)+' / '+Number(u.maxConnections||1)+'</td><td class="actions-cell"><button class="action-btn" title="Copy subscription URL" data-csub="'+esc(url)+'">📋</button><button class="action-btn" title="Edit user" data-euser="'+esc(u.username)+'">✏️</button><button class="action-btn danger" title="Delete user" data-duser="'+esc(u.username)+'">🗑️</button></td></tr>';
        }).join('');
        tbody.querySelectorAll('[data-csub]').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.csub);showToast('Subscription URL copied.','success');}catch(e){prompt('Subscription URL',b.dataset.csub);}});
        tbody.querySelectorAll('[data-euser]').forEach(b=>b.onclick=()=>window.openUserEdit(b.dataset.euser));
        tbody.querySelectorAll('[data-duser]').forEach(b=>b.onclick=()=>window.deleteUser(b.dataset.duser));
    }catch(e){console.error('Commercial table refresh error:',e);}
}

function wrapLegacyLoadUsers(){
    if(typeof window.loadUsers!=='function'||window.loadUsers.__commercialGuard)return false;
    const original=window.loadUsers;
    const wrapped=async function(){const result=await original.apply(this,arguments);await refreshCommercialTable();return result;};
    wrapped.__commercialGuard=true;
    window.loadUsers=wrapped;
    return true;
}

function boot(){
    wrapLegacyLoadUsers();
    refreshCommercialTable();
    const observer=new MutationObserver(()=>{wrapLegacyLoadUsers();});
    if(document.body)observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),20000);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
</script>`;
    return new HTMLRewriter().on('body',{element(element){element.append(patch,{html:true});}}).transform(base);
}
