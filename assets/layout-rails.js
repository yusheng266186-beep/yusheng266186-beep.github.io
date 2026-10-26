/* Native sticky rails: measure on content/size changes, never on scroll. */
(function(){
 'use strict';
 const rails=[...document.querySelectorAll('[data-content-rail]')];
 let frame=0;
 function measure(){
  frame=0;
  const sizes=rails.map(element=>({element,height:Math.ceil(element.getBoundingClientRect().height)}));
  for(const {element,height} of sizes){
   if(height<=0)continue;
   const value=height+'px';
   if(element.style.getPropertyValue('--content-rail-height')!==value)element.style.setProperty('--content-rail-height',value);
   if(element.dataset.railReady!=='true')element.dataset.railReady='true';
  }
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
 if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(schedule);rails.forEach(element=>observer.observe(element));}
 window.addEventListener('resize',schedule,{passive:true});
 document.fonts?.ready.then(schedule);
 schedule();
})();
