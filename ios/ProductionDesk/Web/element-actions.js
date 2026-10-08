// The menu and deletion both use the current production; history handles Undo.
export function createElementActions({project,mutate,confirm,toast}) {
  const menu=document.createElement('div');
  menu.className='element-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Element actions');menu.hidden=true;
  const label=document.createElement('div');label.className='element-context-label';
  const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.setAttribute('role','menuitem');remove.textContent='Delete element';
  menu.append(label,remove);document.body.append(menu);
  let targetId,origin;
  const close=(restore=false)=>{menu.hidden=true;targetId=null;if(restore&&origin?.isConnected)origin.focus();};
  const open=(row,x,y)=>{
    const p=project(),element=p.elements.find(e=>e.id===row.dataset.productionElement);if(!element)return;
    // Commit a pending rename before moving focus into the menu. The change
    // handlers skip equal values, keeping the menu open when the input blurs.
    const name=row.querySelector('[data-element-name]').value.trim();
    if(!name)row.querySelector('[data-element-name]').value=element.name;
    const boardId=row.querySelector('[data-element-id]').value||null;
    if((name&&name!==element.name)||boardId!==element.elementId)mutate(()=>{if(name)element.name=name;element.elementId=boardId;},false);
    targetId=element.id;origin=row.querySelector('[data-element-menu]');label.textContent=element.name;
    menu.hidden=false;
    const rect=menu.getBoundingClientRect(),margin=8;
    menu.style.left=Math.max(margin,Math.min(x,window.innerWidth-rect.width-margin))+'px';
    menu.style.top=Math.max(margin,Math.min(y,window.innerHeight-rect.height-margin))+'px';
    remove.focus();
  };
  remove.onclick=()=>{
    const p=project(),element=p.elements.find(e=>e.id===targetId);close();if(!element)return;
    const affected=p.breakdowns.filter(b=>b.elements.includes(element.id)).length;
    confirm('Delete production element?',`“${element.name}” will be removed from this production${affected?` and ${affected} ${affected===1?'breakdown':'breakdowns'}`:''}. You can undo this change.`,()=>{
      mutate(()=>{
        p.elements=p.elements.filter(e=>e.id!==element.id);
        for(const b of p.breakdowns)b.elements=b.elements.filter(id=>id!==element.id);
        for(const e of p.elements)e.linkedElements=(e.linkedElements||[]).filter(id=>id!==element.id);
      });
      toast(`Deleted “${element.name}”. Undo restores it.`);
    });
  };
  menu.addEventListener('keydown',e=>{if(e.key==='Escape'||e.key==='Tab'){e.preventDefault();close(true);}else if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){e.preventDefault();remove.focus();}});
  document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target))close();},true);
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){e.preventDefault();close(true);}},true);
  document.addEventListener('scroll',()=>close(),true);window.addEventListener('resize',()=>close());
  return {
    close,
    bind(root){
      for(const row of root.querySelectorAll('[data-production-element]')){
        row.addEventListener('contextmenu',e=>{e.preventDefault();open(row,e.clientX,e.clientY);});
        row.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=row.getBoundingClientRect();open(row,r.left+30,r.top+25);}});
        row.querySelector('[data-element-menu]').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();open(row,r.right-190,r.bottom+4);};
      }
    }
  };
}
