import { getMessageAuditLogs, clearMessageAuditLogs, getRetryLogs, clearRetryLogs } from '../modules/statisticsManager.mjs';
const body=document.querySelector('#auditTable tbody');
const senderFilter=document.getElementById('senderFilter');
const refreshBtn=document.getElementById('refreshBtn');
const retryFailedBtn=document.getElementById('retryFailedBtn');
const retrySelectedBtn=document.getElementById('retrySelectedBtn');
const selectAll=document.getElementById('selectAll');
const retryStatus=document.getElementById('retryStatus');
let allRows=[];
let retryLogs=[];
const PROBLEM=new Set(['Ошибка','Обработано частично']);
function esc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function latestPerMessage(rows){
  const map=new Map();const noId=[];
  for(const r of rows){
    if(!r.messageId){noId.push(r);continue;}
    const key=String(r.messageId);const cur=map.get(key);
    if(!cur||(r.timestamp||0)>(cur.timestamp||0))map.set(key,r);
  }
  return [...map.values(),...noId];
}
function retryInfoFor(messageId){
  if(!messageId)return '';
  const rs=retryLogs.filter(x=>String(x.messageId)===String(messageId)).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  if(!rs.length)return '';
  const last=rs[0];
  const parts=[`${esc(last.retryDate||'')} ${esc(last.retryTime||'')}`];
  parts.push(`результат: ${esc(last.afterStatus||'')}`);
  parts.push(`дозагружено: ${esc(last.addedCount||0)}`);
  if(last.error)parts.push(`ошибка: ${esc(last.error)}`);
  const extra=rs.length>1?`<div class='muted'>всего повторов: ${rs.length}</div>`:'';
  return `<div>${parts.join('<br>')}</div>${extra}`;
}
function render(){
  const q=(senderFilter?.value||'').toLowerCase();
  const rows=latestPerMessage([...allRows]).filter(r=>String(r.sender||'').toLowerCase().includes(q)).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
  body.innerHTML=rows.map(r=>{
    const isProblem=PROBLEM.has(r.status||'');
    const cb=isProblem&&r.messageId?`<input type='checkbox' class='rowSel' data-mid='${esc(r.messageId)}'>`:'';
    return `<tr><td>${cb}</td><td>${esc(r.checkedDate||'')}</td><td>${esc(r.checkedTime||'')}</td><td>${esc(r.accountName||'')}</td><td><div>${esc(r.senderName||r.sender||'')}</div><div class='muted'>${esc(r.senderEmail||'')}</div></td><td>${esc(r.subject||'')}</td><td>${esc(r.status||'')}</td><td><div>${esc(r.matchedRuleName||r.matchedRuleFolder||'')}</div><div class='muted'>${esc(r.matchedRuleQuery||'')}</div></td><td>${esc(r.reason||'')}</td><td>${esc(r.processedCount||0)}</td><td>${retryInfoFor(r.messageId)}</td></tr>`;
  }).join('')||`<tr><td colspan='11' class='muted'>Журнал пока пуст</td></tr>`;
}
async function load(){allRows=await getMessageAuditLogs();retryLogs=await getRetryLogs();if(selectAll)selectAll.checked=false;render();}

function selectedMessageIds(){return [...document.querySelectorAll('.rowSel:checked')].map(cb=>cb.dataset.mid);}

async function runRetry(kind){
  if(retryFailedBtn)retryFailedBtn.disabled=true;
  if(retrySelectedBtn)retrySelectedBtn.disabled=true;
  retryStatus.textContent='Идет повторная обработка...';
  try{
    let result;
    if(kind==='failed'){result=await messenger.runtime.sendMessage({type:'retryFailedMessages'});}
    else{const ids=selectedMessageIds();if(!ids.length){retryStatus.textContent='Не выбрано ни одной проблемной записи';return;}result=await messenger.runtime.sendMessage({type:'retryMessages',messageIds:ids});}
    const r=result||{};
    retryStatus.textContent=`Повтор завершен: обработано писем ${r.retried||0}, дозагружено вложений ${r.added||0}, осталось с проблемой ${r.stillFailed||0}`;
    await load();
  }catch(e){retryStatus.textContent='Ошибка повторной обработки: '+e;}
  finally{if(retryFailedBtn)retryFailedBtn.disabled=false;if(retrySelectedBtn)retrySelectedBtn.disabled=false;}
}

refreshBtn?.addEventListener('click',load);
retryFailedBtn?.addEventListener('click',()=>runRetry('failed'));
retrySelectedBtn?.addEventListener('click',()=>runRetry('selected'));
selectAll?.addEventListener('change',()=>{document.querySelectorAll('.rowSel').forEach(cb=>{cb.checked=selectAll.checked;});});
senderFilter?.addEventListener('input',render);
window.addEventListener('DOMContentLoaded',load);
