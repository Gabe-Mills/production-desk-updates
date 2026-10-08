// Local shot lists are a Production Desk extension. USS scene IDs remain the source of truth.
export function formatShotDuration(minutes) {
  const value=Math.max(0,Math.round(minutes)),days=Math.floor(value/1440),hours=Math.floor(value%1440/60),mins=value%60;
  return [days&&`${days}d`,hours&&`${hours}h`,(mins||!value)&&`${mins}m`].filter(Boolean).join(' ');
}
export function createShotDesk(c) {
  const {esc, id, stamp} = c;
  let production, selected, day='all', scene='all', status='all', search='', dragging;
  const statuses=['Planned','Ready','Rolling','Done','Omitted'];
  const sizes=['Wide','Medium wide','Medium','Medium close-up','Close-up','Extreme close-up','Insert','Over the shoulder','POV'];
  const movements=['Static','Pan','Tilt','Dolly','Tracking','Handheld','Steadicam','Crane','Drone'];
  const p=()=>c.project();
  const scenes=()=>p().breakdowns.filter(b=>b.type==='scene');
  const shot=()=>p()._shots.find(s=>s.id===selected);
  const sceneOf=s=>scenes().find(b=>b.id===s.sceneId);
  const label=s=>`${sceneOf(s)?.scene || '?'}${s.number}`;
  const total=s=>s.setupMinutes+s.shootMinutes;
  const active=s=>s.status!=='Omitted';
  const done=s=>s.status==='Done';
  function sync() {
    if(production!==p().id){production=p().id;selected=undefined;day='all';scene='all';status='all';search='';}
    const validDays=groups().map((g,i)=>String(i));
    if(!['all','unscheduled',...validDays].includes(day))day='all';
    if(scene!=='all'&&!scenes().some(s=>s.id===scene))scene='all';
    if(!filtered().some(s=>s.id===selected))selected=filtered()[0]?.id;
  }
  function groups(){return c.groups().filter(Array.isArray);}
  function dayOf(s){const n=groups().findIndex(g=>g.includes(s.sceneId));return n<0?'unscheduled':String(n);}
  function dayName(s){const n=dayOf(s);return n==='unscheduled'?'Unscheduled':`Day ${Number(n)+1}`;}
  function scope(){return p()._shots.filter(s=>day==='all'||dayOf(s)===day);}
  function filtered(){return scope().filter(s=>(scene==='all'||s.sceneId===scene)&&(status==='all'||s.status===status)&&`${label(s)} ${s.description} ${s.camera} ${s.lens} ${s.notes} ${c.slug(sceneOf(s))}`.toLowerCase().includes(search.toLowerCase()));}
  function nextNumber(sceneId){
    const used=new Set(p()._shots.filter(s=>s.sceneId===sceneId).map(s=>s.number.toUpperCase()));
    for(let n=0;n<10000;n++){let v=n+1,result='';while(v){v--;result=String.fromCharCode(65+v%26)+result;v=Math.floor(v/26);}if(!used.has(result))return result;}
    return String(p()._shots.length+1);
  }
  function clock(mins){const raw=Math.round(mins),n=((raw%1440)+1440)%1440;return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}${raw>=1440?` +${Math.floor(raw/1440)}d`:''}`;}
  function timings(){
    const [h,m]=p()._shotSettings.startTime.split(':').map(Number);let elapsed=0;const map=new Map();
    for(const s of scope()){map.set(s.id,day==='all'?`+${elapsed}m`:clock(h*60+m+elapsed));if(active(s))elapsed+=total(s);}
    return map;
  }
  function metrics(){
    const shots=scope().filter(active), completed=shots.filter(done),estimate=shots.reduce((n,s)=>n+total(s),0),remaining=shots.filter(s=>!done(s)).reduce((n,s)=>n+total(s),0);
    const reported=completed.filter(s=>s.actualMinutes!==null);
    const actual=reported.reduce((n,s)=>n+s.actualMinutes,0),planned=reported.reduce((n,s)=>n+total(s),0);
    const variance=actual-planned;
    return `<div class="shot-metrics"><div><strong>${shots.length}</strong><span>planned shots</span></div><div><strong>${completed.length}<small> / ${shots.length}</small></strong><span>completed</span></div><div><strong class="shot-duration">${formatShotDuration(estimate)}</strong><span>estimated total</span></div><div><strong class="shot-duration">${formatShotDuration(remaining)}</strong><span>remaining estimate</span></div><div><strong>${reported.length?(variance>0?'+':'')+variance:'—'}<small> min</small></strong><span>actual vs plan · reported</span></div></div><progress class="shot-progress" aria-label="Shots completed" max="${shots.length||1}" value="${completed.length}"></progress>`;
  }
  function selectOptions(values,value){return values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('');}
  function sceneOptions(value){return scenes().map(b=>`<option value="${esc(b.id)}" ${b.id===value?'selected':''}>${esc(b.scene)} · ${esc(c.slug(b))}</option>`).join('');}
  function rows(){
    const times=timings(),list=filtered();
    return list.length?list.map(s=>`<article class="shot-row ${s.id===selected?'selected':''} ${s.status.toLowerCase()}" draggable="true" data-shot="${esc(s.id)}"><span class="shot-grip" aria-hidden="true">⠿</span><button class="shot-row-main" data-shot-select="${esc(s.id)}" aria-label="Select shot ${esc(label(s))}"><span class="shot-row-top"><strong>${esc(label(s))}</strong><span class="shot-state ${s.status.toLowerCase()}">${esc(s.status)}</span><span class="shot-day">${esc(dayName(s))}</span></span><span class="shot-description">${esc(s.description || 'Untitled shot')}</span><span class="shot-specs">${esc([s.size,s.camera&&'Camera '+s.camera,s.lens&&s.lens+' mm',s.movement].filter(Boolean).join(' · '))}</span></button><div class="shot-row-time"><strong>${esc(times.get(s.id))}</strong><span>${total(s)} min</span></div><button class="shot-check" data-shot-done="${esc(s.id)}" aria-label="${done(s)?'Reopen':'Complete'} shot ${esc(label(s))}" ${s.status==='Omitted'?'disabled':''}>${done(s)?'✓':'○'}</button></article>`).join(''):`<div class="shot-empty"><span class="empty-frame">＋</span><h2>${p()._shots.length?'No shots match this view':'Build your coverage'}</h2><p>${p()._shots.length?'Try a different day, scene, or status.':'Start with a scene, then add your camera setups, coverage, and time estimates.'}</p><button class="primary" data-shot-action="new">＋ Add a shot</button></div>`;
  }
  function editField(label,key,value,type='text',wide=false,extra='') {return `<label class="field ${wide?'wide':''}">${label}<input data-shot-field="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;}
  function suggestions(label,key,value,values){return editField(label,key,value,'text',false,`list="shot-${key}-options"`)+`<datalist id="shot-${key}-options">${values.map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`;}
  function editor(){
    const s=shot();if(!s)return '<div class="shot-editor-empty"><div class="eyebrow">SHOT DETAILS</div><p>Select a shot to plan its setup and track your takes.</p></div>';
    return `<div class="shot-detail-heading"><div><div class="eyebrow">SHOT DETAILS</div><h2 id="shot-detail-label">${esc(label(s))}</h2></div><div class="shot-order"><button data-shot-action="up" aria-label="Move shot up" title="Move up">↑</button><button data-shot-action="down" aria-label="Move shot down" title="Move down">↓</button></div></div><div class="shot-editor-scroll"><div class="form-grid"><label class="field wide">Scene<select data-shot-field="sceneId">${sceneOptions(s.sceneId)}</select></label>${editField('Shot number / suffix','number',s.number,'text',false,'required maxlength="24"')}<label class="field">Status<select data-shot-field="status">${selectOptions(statuses,s.status)}</select></label><label class="field wide">Shot description<textarea data-shot-field="description" rows="3">${esc(s.description)}</textarea></label>${suggestions('Shot size','size',s.size,sizes)}${suggestions('Movement','movement',s.movement,movements)}${editField('Camera','camera',s.camera)}${editField('Lens (mm)','lens',s.lens)}${editField('Equipment / support','equipment',s.equipment,'text',true)}${editField('Setup (minutes)','setupMinutes',s.setupMinutes,'number',false,'min="0" max="1440" step="1"')}${editField('Shoot (minutes)','shootMinutes',s.shootMinutes,'number',false,'min="0" max="1440" step="1"')}${editField('Actual total (minutes)','actualMinutes',s.actualMinutes,'number',false,'min="0" max="10080" step="1"')}${editField('Takes','takes',s.takes,'number',false,'min="0" max="10000" step="1"')}<label class="field">Priority<select data-shot-field="priority">${selectOptions(['Essential','Preferred','Optional'],s.priority)}</select></label>${editField('Circle take','circleTake',s.circleTake)}<label class="field wide">Notes<textarea data-shot-field="notes" rows="3">${esc(s.notes)}</textarea></label></div><div class="shot-editor-actions"><button data-shot-action="take">＋ Take</button><button data-shot-action="duplicate">Duplicate</button><button class="danger" data-shot-action="delete">Delete</button></div><p class="shot-editor-note">Details save as you type. Actual time is entered manually and includes setup. Omitted shots are excluded from estimates.</p></div>`;
  }
  function render(){sync();const ds=c.dates(groups().length);
    return `<div class="shot-page-heading"><div><div class="eyebrow">CAMERA DEPARTMENT</div><h2>Shot list</h2><p>Plan the coverage. Keep the day moving.</p></div><div class="shot-heading-tools"><button data-shot-action="csv">Export shots</button><button data-shot-action="print">Print / PDF</button></div></div><div id="shot-metrics">${metrics()}</div><div class="shot-toolbar">${c.scenarioSelect()}<label>Shoot day<select id="shot-day"><option value="all" ${day==='all'?'selected':''}>All days</option>${groups().map((g,i)=>`<option value="${i}" ${day===String(i)?'selected':''}>Day ${i+1} · ${esc(c.dateLabel(ds[i]))}</option>`).join('')}<option value="unscheduled" ${day==='unscheduled'?'selected':''}>Unscheduled</option></select></label><label>Scene<select id="shot-scene"><option value="all">All scenes</option>${sceneOptions(scene)}</select></label><label>Status<select id="shot-status"><option value="all">All statuses</option>${selectOptions(statuses,status)}</select></label><label class="shot-start">Start time<input type="time" id="shot-start" value="${esc(p()._shotSettings.startTime)}" ${day==='all'?'disabled':''}></label></div><div class="shot-layout"><section class="panel shot-list-panel"><div class="panel-header"><div class="panel-title">Shooting order <span class="count" id="shot-count">${filtered().length} shots</span></div><span class="tiny">DRAG TO REORDER</span></div><div class="shot-search-wrap"><input id="shot-search" type="search" aria-label="Search shots" placeholder="Search shots, cameras, notes…" value="${esc(search)}"></div><div class="shot-list" id="shot-list">${rows()}</div><div class="panel-footer">${day==='all'?'All days show cumulative minute offsets. Select one day for clock times.':'Times follow the day’s full shot order, including shots hidden by filters.'}</div></section><section class="panel shot-editor" id="shot-editor">${editor()}</section></div>`;
  }
  function refreshList(){document.querySelector('#shot-metrics').innerHTML=metrics();document.querySelector('#shot-list').innerHTML=rows();document.querySelector('#shot-count').textContent=`${filtered().length} shots`;const heading=document.querySelector('#shot-detail-label');if(heading&&shot())heading.textContent=label(shot());bindRows();}
  function moveBefore(moving,target){if(moving===target)return;c.mutate(()=>{const list=p()._shots,s=list.find(s=>s.id===moving);if(!s)return;list.splice(list.indexOf(s),1);list.splice(list.findIndex(s=>s.id===target),0,s);});}
  function bindRows(){
    document.querySelectorAll('[data-shot-select]').forEach(b=>b.onclick=()=>{selected=b.dataset.shotSelect;c.render();});
    document.querySelectorAll('[data-shot-done]').forEach(b=>b.onclick=()=>c.mutate(()=>{const s=p()._shots.find(s=>s.id===b.dataset.shotDone);s.status=done(s)?'Planned':'Done';}));
    document.querySelectorAll('[data-shot]').forEach(row=>{
      row.ondragstart=e=>{dragging=row.dataset.shot;e.dataTransfer.setData('text/plain',dragging);e.dataTransfer.effectAllowed='move';};
      row.ondragend=()=>{dragging=null;document.querySelectorAll('.shot-drop').forEach(r=>r.classList.remove('shot-drop'));};
      row.ondragover=e=>{if(!dragging)return;e.preventDefault();row.classList.add('shot-drop');};
      row.ondragleave=()=>row.classList.remove('shot-drop');
      row.ondrop=e=>{e.preventDefault();if(dragging)moveBefore(dragging,row.dataset.shot);dragging=null;};
    });
    document.querySelectorAll('#shot-list [data-shot-action]').forEach(b=>b.onclick=()=>action(b.dataset.shotAction));
  }
  function bind(){
    bindRows();
    for(const [key,set] of [['day',v=>day=v],['scene',v=>scene=v],['status',v=>status=v]])document.querySelector('#shot-'+key).onchange=e=>{set(e.target.value);selected=filtered()[0]?.id;c.render();};
    document.querySelector('#shot-search').oninput=e=>{search=e.target.value;refreshList();};
    document.querySelector('#shot-start').onchange=e=>{if(e.target.checkValidity()&&e.target.value)c.mutate(()=>p()._shotSettings.startTime=e.target.value);};
    document.querySelectorAll('[data-shot-action]').forEach(b=>b.onclick=()=>action(b.dataset.shotAction));
    document.querySelectorAll('[data-shot-field]').forEach(input=>{
      let editing=false;const target=shot();
      const update=()=>{
        if(!target||!input.reportValidity())return;
        const key=input.dataset.shotField,value=input.type==='number'?(key==='actualMinutes'&&input.value===''?null:Number(input.value)):input.value;
        if((key==='number'||key==='sceneId')&&p()._shots.some(s=>s.id!==target.id&&s.sceneId===(key==='sceneId'?value:target.sceneId)&&s.number.toUpperCase()===(key==='number'?value:target.number).toUpperCase())){input.setCustomValidity('This scene already has that shot number.');input.reportValidity();input.setCustomValidity('');return;}
        c.edit(()=>target[key]=value,!editing);editing=true;refreshList();
      };
      input.oninput=update;input.onchange=()=>{update();editing=false;};input.onblur=()=>editing=false;
    });
  }
  function insertShot(data,after) {
    const selectors=['#shot-list','.shot-editor-scroll'];
    const positions=selectors.map(selector=>[selector,document.querySelector(selector)?.scrollTop||0]);
    const pageTop=document.scrollingElement.scrollTop;
    c.mutate(()=>{
      if(after)p()._shots.splice(p()._shots.indexOf(after)+1,0,data);else p()._shots.push(data);
      // Keep the user's view. A new planned shot can be hidden by a status,
      // search, scene, or day filter; creating it must not clear those filters.
      if(filtered().some(s=>s.id===data.id))selected=data.id;
    });
    document.querySelector('#modal').close();
    for(const [selector,top] of positions){const element=document.querySelector(selector);if(element)element.scrollTop=top;}
    document.scrollingElement.scrollTop=pageTop;
    if(!filtered().some(s=>s.id===data.id))c.toast('Shot added. It is hidden by your current filters.');
  }
  function add(){
    if(!scenes().length){c.toast('Add or import a scene before creating a shot.');return;}
    const initialScene=scene!=='all'?scene:shot()?.sceneId||c.selectedScene()||scenes()[0].id;
    const validScene=scenes().some(b=>b.id===initialScene)?initialScene:scenes()[0].id;
    const setup=shot()?.setupMinutes??10,shoot=shot()?.shootMinutes??15;
    c.modal('Add a shot',`<p>Link the shot to a scene. Its shooting day follows that scene’s schedule.</p><form id="new-shot-form"><div class="form-grid"><label class="field wide">Scene<select id="new-shot-scene">${sceneOptions(validScene)}</select></label><label class="field">Shot number / suffix<input id="new-shot-number" value="${esc(nextNumber(validScene))}" required maxlength="24"></label><label class="field">Shot size<input id="new-shot-size" value="Wide" list="new-shot-sizes"><datalist id="new-shot-sizes">${sizes.map(v=>`<option value="${esc(v)}">`).join('')}</datalist></label><label class="field wide">Description<textarea id="new-shot-description" placeholder="e.g. Wide master — Maya enters the kitchen" rows="3" required></textarea></label><label class="field">Setup (minutes)<input id="new-shot-setup" type="number" value="${setup}" min="0" max="1440" step="1" required></label><label class="field">Shoot (minutes)<input id="new-shot-shoot" type="number" value="${shoot}" min="0" max="1440" step="1" required></label></div></form>`,'<button id="modal-cancel">Cancel</button><button id="new-shot-save" class="primary">Add shot</button>');
    document.querySelector('#new-shot-scene').onchange=e=>document.querySelector('#new-shot-number').value=nextNumber(e.target.value);
    document.querySelector('#new-shot-save').onclick=()=>{
      const form=document.querySelector('#new-shot-form');if(!form.reportValidity())return;
      const sceneId=document.querySelector('#new-shot-scene').value,number=document.querySelector('#new-shot-number').value.trim(),description=document.querySelector('#new-shot-description').value.trim();
      if(!number||!description)return;
      if(p()._shots.some(s=>s.sceneId===sceneId&&s.number.toUpperCase()===number.toUpperCase())){document.querySelector('#modal-error').textContent='This scene already has that shot number.';return;}
      const data={id:id(),created:stamp(),sceneId,number,description,size:document.querySelector('#new-shot-size').value,movement:'Static',camera:'A',lens:'',equipment:'Tripod',setupMinutes:Number(document.querySelector('#new-shot-setup').value),shootMinutes:Number(document.querySelector('#new-shot-shoot').value),actualMinutes:null,takes:0,circleTake:'',priority:'Essential',notes:'',status:'Planned'};
      insertShot(data);
    };
    document.querySelector('#new-shot-description').focus();
  }
  function csv(){sync();const rows=[['Day','Scene','Shot','Description','Size','Movement','Camera','Lens mm','Equipment','Setup minutes','Shoot minutes','Actual minutes','Status','Takes','Circle take','Priority','Notes'],...filtered().map(s=>[dayName(s),sceneOf(s)?.scene,label(s),s.description,s.size,s.movement,s.camera,s.lens,s.equipment,s.setupMinutes,s.shootMinutes,s.actualMinutes,s.status,s.takes,s.circleTake,s.priority,s.notes])];const safe=v=>{let value=String(v??'');if(/^[=+@\-\t\r]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"';};c.download('shot-list.csv',rows.map(row=>row.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8');}
  function print(){const times=timings();document.querySelector('#print-area').innerHTML=`<h1>${esc(p().project||p().name)} · Shot list</h1><p>${esc(c.scenarioName())} · ${day==='all'?'All days':day==='unscheduled'?'Unscheduled':'Day '+(Number(day)+1)} · ${filtered().length} shots</p><table><thead><tr><th>Day / Time</th><th>Shot</th><th>Description</th><th>Camera setup</th><th>Est. / Actual</th><th>Status / Takes</th><th>Notes</th></tr></thead><tbody>${filtered().map(s=>`<tr><td>${esc(dayName(s))}<br>${esc(times.get(s.id))}</td><td>${esc(label(s))}</td><td>${esc(s.description)}</td><td>${esc([s.size,s.camera&&'Cam '+s.camera,s.lens&&s.lens+'mm',s.movement,s.equipment].filter(Boolean).join(' · '))}</td><td>${total(s)} / ${s.actualMinutes??'—'} min</td><td>${esc(s.status)} · ${s.takes}${s.circleTake?' · circle '+esc(s.circleTake):''}</td><td>${esc(s.notes)}</td></tr>`).join('')}</tbody></table>`;window.print();}
  function action(name){
    if(name==='new')return add();if(name==='csv')return csv();if(name==='print')return print();
    const s=shot();if(!s)return;
    if(name==='take')c.mutate(()=>s.takes=Math.min(10000,s.takes+1));
    if(name==='duplicate')insertShot({...structuredClone(s),id:id(),created:stamp(),number:nextNumber(s.sceneId),status:'Planned',actualMinutes:null,takes:0,circleTake:''},s);
    if(name==='delete')c.confirm('Delete shot '+esc(label(s))+'?','You can undo this change.',()=>c.mutate(()=>{p()._shots=p()._shots.filter(x=>x.id!==s.id);selected=undefined;}));
    if(name==='up'||name==='down'){const visible=filtered(),i=visible.indexOf(s),neighbor=visible[i+(name==='up'?-1:1)];if(neighbor)c.mutate(()=>{const list=p()._shots,a=list.indexOf(s),b=list.indexOf(neighbor);[list[a],list[b]]=[list[b],list[a]];});}
  }
  return {render,bind,add,csv,print};
}
