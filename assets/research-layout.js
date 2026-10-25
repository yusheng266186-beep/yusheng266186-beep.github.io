(function(){
 'use strict';
 const root=document.getElementById('researchWorkspace');if(!root)return;
 const tabs=[...root.querySelectorAll('[data-research-tab]')],panes=[...root.querySelectorAll('[data-research-pane]')];
 function select(name,focus=false){if(!tabs.some(t=>t.dataset.researchTab===name))return;tabs.forEach(t=>{const active=t.dataset.researchTab===name;t.setAttribute('aria-selected',String(active));t.tabIndex=active?0:-1;if(active&&focus)t.focus();});panes.forEach(p=>p.hidden=p.dataset.researchPane!==name);}
 function reveal(target){if(typeof target==='string'){try{target=document.getElementById(decodeURIComponent(target.replace(/^#/,'')));}catch{return;}}const pane=panes.find(p=>p.contains(target));if(!pane)return;root.open=true;select(pane.dataset.researchPane);for(let e=target;e&&e!==root;e=e.parentElement)if(e.tagName==='DETAILS')e.open=true;}
 tabs.forEach((button,i)=>{button.addEventListener('click',()=>select(button.dataset.researchTab));button.addEventListener('keydown',event=>{let n;if(event.key==='ArrowRight')n=(i+1)%tabs.length;else if(event.key==='ArrowLeft')n=(i+tabs.length-1)%tabs.length;else if(event.key==='Home')n=0;else if(event.key==='End')n=tabs.length-1;else return;event.preventDefault();select(tabs[n].dataset.researchTab,true);});});
 document.addEventListener('click',event=>{const link=event.target.closest('a[href^="#"]');if(link&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey)reveal(link.getAttribute('href'));});
 window.addEventListener('hashchange',()=>reveal(location.hash));window.addEventListener('popstate',()=>reveal(location.hash));reveal(location.hash);
 window.AurumResearchLayout={reveal};
})();
