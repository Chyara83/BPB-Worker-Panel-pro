import { enhanceCommercialPanel as enhanceCommercialPanelV2 } from '@common/commercial-panel-v2';

export function enhanceCommercialPanel(response: Response): Response {
    const base = enhanceCommercialPanelV2(response);
    const patch = `<script>
(function(){
'use strict';
const $=(id)=>document.getElementById(id);
let refreshTimer=0;

function fixCommercialTable(){
    const tab=$('tab-users');
    const table=tab&&tab.querySelector('table');
    if(!table)return false;
    const head=table.querySelector('thead tr');
    if(head&&!head.querySelector('[data-commercial-col="traffic"]')){
        head.insertAdjacentHTML('beforeend','<th data-commercial-col="traffic">Traffic</th><th data-commercial-col="devices">Devices</th>');
    }
    return !!(head&&head.querySelector('[data-commercial-col="traffic"]'));
}

function installLoadUsersGuard(){
    if(typeof window.loadUsers!=='function'||window.loadUsers.__commercialGuard)return false;
    const original=window.loadUsers;
    const wrapped=async function(){
        const result=await original.apply(this,arguments);
        setTimeout(()=>{ if(typeof window.loadUsersCommercial==='function') window.loadUsersCommercial(); },0);
        setTimeout(fixCommercialTable,0);
        return result;
    };
    wrapped.__commercialGuard=true;
    window.loadUsers=wrapped;
    return true;
}

function installCommercialRefreshBridge(){
    if(typeof window.loadUsersCommercial!=='function')return false;
    if(!window.__commercialRefreshBridge){
        window.__commercialRefreshBridge=true;
        const original=window.loadUsersCommercial;
        window.loadUsersCommercial=async function(){
            const result=await original.apply(this,arguments);
            fixCommercialTable();
            return result;
        };
    }
    return true;
}

function boot(){
    installCommercialRefreshBridge();
    installLoadUsersGuard();
    fixCommercialTable();
    if(!refreshTimer){
        let attempts=0;
        refreshTimer=setInterval(()=>{
            attempts++;
            installCommercialRefreshBridge();
            installLoadUsersGuard();
            fixCommercialTable();
            if(attempts>=60){clearInterval(refreshTimer);refreshTimer=0;}
        },500);
    }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});
else boot();
})();
</script>`;
    return new HTMLRewriter()
        .on('body',{element(element){element.append(patch,{html:true});}})
        .transform(base);
}
