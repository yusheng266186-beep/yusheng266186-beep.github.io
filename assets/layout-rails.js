/* Both columns follow the reader; stacked layouts stay in normal flow. No scroll handler. */
(function(){
 'use strict';
 const rails=[...document.querySelectorAll('[data-content-rail]')];
 let frame=0;
 function measure(){
  frame=0;
  const sizes=rails.map(element=>({element,rect:element.getBoundingClientRect()}));
  for(const {element,rect} of sizes){
   const height=Math.ceil(rect.height),group=element.parentElement.hasAttribute('data-rail-group'),peers=group?sizes.filter(x=>x.element.parentElement===element.parentElement&&x.element!==element&&x.rect.width>0):[];
   const columns=!group||peers.some(x=>rect.right<=x.rect.left+1||x.rect.right<=rect.left+1),ready=height>0&&rect.width>0&&columns;
   if(element.dataset.railReady!==String(ready))element.dataset.railReady=String(ready);
   if(!ready)continue;
   const value=height+'px';
   if(element.style.getPropertyValue('--content-rail-height')!==value)element.style.setProperty('--content-rail-height',value);
  }
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
 if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);rails.forEach(element=>observer.observe(element));}
 window.addEventListener('resize',schedule,{passive:true});
 document.fonts?.ready.then(schedule);
 schedule();
})();
