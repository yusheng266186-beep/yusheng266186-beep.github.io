/* One optional tool surface; preserve old links to evidence, audits and replay. */
(function(){
 'use strict';
 const root=document.getElementById('forecastDetails');if(!root)return;
 const tabs=[...root.querySelectorAll('[data-forecast-tab]')],panes=[...root.querySelectorAll('[data-forecast-pane]')];
 function select(name,focus=false){
  if(!tabs.some(t=>t.dataset.forecastTab===name))return;
  tabs.forEach(t=>{const active=t.dataset.forecastTab===name;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;if(active&&focus)t.focus();});
  panes.forEach(p=>p.hidden=p.dataset.forecastPane!==name);
 }
 function reveal(fragment){
  let id;try{id=decodeURIComponent(String(fragment||'').replace(/^#/,''));}catch{return;}
  const target=document.getElementById(id),pane=panes.find(p=>p.contains(target));if(!pane)return;
  root.open=true;select(pane.dataset.forecastPane);
 }
 tabs.forEach((button,index)=>{
  button.addEventListener('click',()=>select(button.dataset.forecastTab));
  button.addEventListener('keydown',event=>{
   let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;
   event.preventDefault();select(tabs[next].dataset.forecastTab,true);
  });
 });
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href^="#"]');if(link&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)reveal(link.getAttribute('href'));
 });
 window.addEventListener('hashchange',()=>reveal(location.hash));window.addEventListener('popstate',()=>reveal(location.hash));reveal(location.hash);
})();
