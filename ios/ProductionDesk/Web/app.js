import {STRIP_PALETTE, validStripColor, stripTextColor, applyStripColors} from './strip-colors.js';
import {createShotDesk} from './shots.js';
import {nativeAPI, nativePrint} from './native-platform.js';
import {createAppSettings} from './settings.js';
import {createElementActions} from './element-actions.js';
import {setupMobileLayout,setupMobileContent} from './mobile-layout.js';
const isIPadApp = !!window.webkit?.messageHandlers?.scheduler;
const savedLabel = isIPadApp ? '✓ Saved on this device' : '✓ Saved on this computer';
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const clone = value => structuredClone(value);
let workspace, project, selected, view = 'workspace', report = 'oneline', scenarioIndex = 0;
let history = [], future = [], revision = 0, savedRevision = 0, saving = false, saveTimer;
let search = '', elementSearch = '', elementCategory = '', dragging = null, selectedText = '', toastTimer;
// Both native hosts flush pending edits before leaving the foreground.
window.slateDesktop = {flush:async()=>{
  clearTimeout(saveTimer);
  const deadline=Date.now()+15000;
  while(saving && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  if(saving)return false;
  await save();
  while(saving && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  return savedRevision===revision;
}};

window.productionDeskSave = () => window.slateDesktop.flush();
document.addEventListener('visibilitychange', () => { if (document.hidden && workspace) window.productionDeskSave(); });
window.addEventListener('pagehide', () => { if (workspace) window.productionDeskSave(); });

async function api(path, data, headers = {}) {
  if (isIPadApp) return nativeAPI(path, data, headers);
  const options = data === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json','X-Slate-Local':'1',...headers}, body: typeof data === 'string' || data instanceof File ? data : JSON.stringify(data)};
  const response = await fetch(path, options);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Local operation failed.');
  return value;
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function activeScenario() { return project.stripboards[scenarioIndex] || project.stripboards[0]; }
function calendar() { return project.calendars.find(c => c.id === activeScenario()?.calendar); }
function activeBoard() { return activeScenario()?.boards[0]; }
function boneyard() { return activeScenario()?.boards[1]; }
function breakdown(sceneId = selected) { return project.breakdowns.find(b => b.id === sceneId); }
function category(ucid) { return project.categories.find(c => c.ucid === ucid); }
function items(b, ucid) { const cat = category(ucid); return cat ? project.elements.filter(e => e.category === cat.id && b?.elements.includes(e.id)) : []; }
function prop(b, ucid) { return items(b, ucid).map(e => e.name).join(', '); }
function slug(b) { return `${prop(b,1) || 'INT'}. ${prop(b,0) || 'UNTITLED SET'} — ${prop(b,2) || 'Day'}`; }
function pages(value) { if (!value) return '0'; const eighths = Math.round(value * 8), whole = Math.floor(eighths / 8), rem = eighths % 8; return rem ? `${whole ? whole + ' ' : ''}${rem}/8` : String(whole); }
function minutes(value) { const m = Math.round((value || 0)/60000); return m >= 60 ? `${Math.floor(m/60)}h${m%60 ? ' '+m%60+'m' : ''}` : `${m}m`; }
function customStripAttrs(b){return validStripColor(b._stripColor)?`data-strip-color="${b._stripColor}"`:'';}
function stripClass(b) { const tod = prop(b,2).toLowerCase(); return tod.includes('night') ? 'night' : /dusk|dawn|evening/.test(tod) ? 'dusk' : prop(b,1).includes('EXT') ? 'ext' : ''; }
function sceneList() { return project.breakdowns.filter(b => b.type === 'scene'); }
function mark() { revision++; $('#save-status').textContent = 'Saving to disk…'; clearTimeout(saveTimer); if (isIPadApp) save(); else saveTimer = setTimeout(save, 300); }
async function save() {
  if (saving || savedRevision === revision) return;
  saving = true;
  const target = revision, snapshot = clone(workspace);
  try { await api('/api/workspace', snapshot); savedRevision = target; $('#save-status').textContent = savedLabel; }
  catch(e) { $('#save-status').textContent = 'Save failed · click to retry'; toast(e.message); }
  finally { saving = false; if (savedRevision === target && revision > target) save(); }
}
function mutate(fn, redraw = true) {
  history.push(clone(workspace)); if (history.length > 40) history.shift(); future = [];
  fn(); mark(); if (redraw) render(); updateUndo();
}
function updateUndo() { $('#undo').disabled = !history.length; $('#redo').disabled = !future.length; }
function undo(forward = false) {
  const source = forward ? future : history, destination = forward ? history : future;
  if (!source.length) return;
  destination.push(clone(workspace)); workspace = source.pop(); useProject(); mark(); render();
}
function normalize(p) {
  p._shots ||= []; p._shotSettings ||= {startTime:'07:00'};
  p.categories ||= []; p.elements ||= []; p.breakdowns ||= []; p.calendars ||= []; p.stripboards ||= [];
  for (const key of ['author','company','description','episode','episodeName','project','schedColor','schedDate','scriptColor','scriptDate','season']) p[key] ??= null;
  for (const e of p.elements) {
    Object.assign(e, {created:e.created || p.created, daysOff:e.daysOff || [], dropDayCount:e.dropDayCount ?? 0, elementId:e.elementId ?? null, events:e.events || [], isDood:e.isDood ?? true, isDrop:e.isDrop ?? true, isHold:e.isHold ?? true, isIdLock:e.isIdLock ?? false, linkedElements:e.linkedElements || []});
  }
  for (const c of p.calendars) { c.events ||= []; c.daysOff ||= []; }
  for (const b of p.breakdowns) for (const key of ['bannerText','comments','description','pages','scene','scriptPage','duration']) b[key] ??= null;
  for (const s of p.stripboards) {
    if (!s.boards.length) s.boards.push({id:id(),name:'stripboard',breakdownIds:[]});
    if (s.boards.length === 1) s.boards.push({id:id(),name:'boneyard',breakdownIds:[]});
  }
  return p;
}
function useProject() {
  project = workspace.projects.find(p => p.id === workspace.activeProject) || workspace.projects[0];
  workspace.activeProject = project.id; normalize(project);
  if (scenarioIndex >= project.stripboards.length) scenarioIndex = 0;
  if (!breakdown()) selected = sceneList()[0]?.id || project.breakdowns[0]?.id;
}
function addElement(b, ucid, name) {
  name = name.trim(); if (!name) return;
  let cat = category(ucid);
  if (!cat) { const names = {0:'Set',1:'INT/EXT',2:'Day/Night',3:'Script Day',4:'Unit',6:'Location',100:'Cast Members'}; cat = {id:id(),ucid,name:names[ucid] || 'Category',created:stamp()}; project.categories.push(cat); }
  let e = project.elements.find(e => e.category === cat.id && e.name.toLowerCase() === name.toLowerCase());
  if (!e) { e = {id:id(), category:cat.id, created:stamp(), name, daysOff:[],dropDayCount:0,elementId:ucid === 100 ? String(project.elements.filter(e=>e.category === cat.id).length+1) : null,events:[],isDood:ucid===100,isDrop:true,isHold:true,isIdLock:false,linkedElements:[]}; project.elements.push(e); }
  if (!b.elements.includes(e.id)) b.elements.push(e.id);
}
function setProp(b, ucid, name) { const cat = category(ucid); if (cat) b.elements = b.elements.filter(eid => project.elements.find(e=>e.id === eid)?.category !== cat.id); addElement(b,ucid,name); }
function dates(count) {
  const c = calendar(); const start = c?.events.find(e=>e.type==='start')?.date?.slice(0,10);
  if (!start) return Array(count).fill(null);
  const off = new Set((c.events || []).filter(e=>e.type==='dayOff').map(e=>e.date.slice(0,10)));
  let d = new Date(start+'T12:00:00Z'), result = [], guard = 0;
  while (result.length < count && guard++ < 36500) {
    const date = d.toISOString().slice(0,10);
    if (!(c.daysOff || []).includes(d.getUTCDay()) && !off.has(date)) result.push(date);
    d.setUTCDate(d.getUTCDate()+1);
  }
  return result;
}
function dateLabel(date) { return date ? new Date(date+'T12:00:00Z').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',timeZone:'UTC'}) : 'Set start date'; }
function scheduleGroups(board = activeBoard()) { return board?.breakdownIds || []; }
function totals(ids) { return ids.map(x=>breakdown(x)).filter(Boolean).reduce((a,b)=>({pages:a.pages+(b.pages||0),duration:a.duration+(b.duration||0),scenes:a.scenes+(b.type==='scene'?1:0)}),{pages:0,duration:0,scenes:0}); }
function allScheduled() { return activeBoard()?.breakdownIds.flat() || []; }

function render() {
  elementActions.close();
  useProject();
  document.body.classList.toggle('view-shots',view==='shots');
  $('#project-picker').innerHTML = workspace.projects.map(p=>`<option value="${esc(p.id)}" ${p.id===project.id?'selected':''}>${esc(p.project || p.name)}</option>`).join('');
  $('#project-title').textContent = project.project || project.name;
  $('#breadcrumb').textContent = project.project || project.name;
  $('#project-eyebrow').textContent = project._demo ? 'SAMPLE PRODUCTION · EXPLORE THE WORKSPACE' : 'PRODUCTION WORKSPACE';
  const subtitles = {workspace:'From the page to the production. One scene at a time.',schedule:'Build your shooting days. Keep the whole story in view.',elements:'Every person, place, and thing your production needs.',reports:'A clear picture of the days ahead.',shots:'Scene by scene. Setup by setup. Every shot accounted for.'};
  $('#page-subtitle').textContent = subtitles[view];
  $$('#navigation button').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const scenes = sceneList(), t = totals(scenes.map(b=>b.id)), scheduled = allScheduled().filter(x=>breakdown(x)?.type==='scene').length;
  const dayCount = scheduleGroups().filter(Array.isArray).length;
  $('#summary').innerHTML = `<div class="summary-stat"><strong>${scenes.length}</strong><span>scenes</span></div><div class="summary-stat"><strong>${pages(t.pages)}</strong><span>pages</span></div><div class="summary-stat"><strong>${dayCount}</strong><span>shoot days</span></div><div class="summary-stat"><strong>${scenes.length-scheduled}</strong><span>unscheduled</span></div><div class="summary-note"><span>●</span> Local files · USS 1.0.0</div>`;
  $('#add-scene').textContent=view==='shots'?'＋ New shot':'＋ New scene';
  $('#content').innerHTML = view === 'shots' ? shotDesk.render() : view === 'workspace' ? workspaceView() : view === 'schedule' ? scheduleView() : view === 'elements' ? elementsView() : reportsView();
  bindContent(); applyStripColors(); updateUndo();
  if (window.slateDesktop) setupMobileContent();
}
function emptyPanel(message) { return `<div class="empty-state"><h3>A story starts here.</h3>${message}<br><button class="primary" data-action="import">Import your script</button></div>`; }
function workspaceView() {
  return `<div class="workspace">${scriptPanel()}${breakdownPanel()}</div>`;
}
function scriptPanel() {
  const b = breakdown(), filtered = sceneList().filter(s=>`${s.scene} ${slug(s)} ${s.description}`.toLowerCase().includes(search.toLowerCase()));
  return `<section class="panel"><div class="panel-header"><div class="panel-title"><span class="symbol">▤</span>Script <span class="count">${sceneList().length} scenes</span></div><button class="text-button" data-action="edit-script" ${b?.type==='scene'?'':'disabled'}>Edit text</button></div>
    <div class="script-toolbar"><input class="scene-search" id="scene-search" placeholder="Search scenes, sets, descriptions…" value="${esc(search)}" aria-label="Search scenes"><button class="icon-btn" data-action="prev" aria-label="Previous scene">‹</button><select id="scene-picker" aria-label="Choose scene">${filtered.map(s=>`<option value="${esc(s.id)}" ${s.id===selected?'selected':''}>${esc(s.scene)} · ${esc(prop(s,0))}</option>`).join('')}</select><button class="icon-btn" data-action="next" aria-label="Next scene">›</button></div>
    <div class="script-selection"><span>Select text in the script to tag a production element.</span><div class="tag-row"><select id="tag-category" aria-label="Tag category">${project.categories.filter(c=>c.ucid>=100).map(c=>`<option value="${c.ucid}">${esc(c.name)}</option>`).join('')}</select><button id="tag-selection">＋ Tag selection</button></div></div>
    <div class="script-scroll">${!b ? emptyPanel('Import a screenplay or add your first scene.') : b.type==='banner' ? '<div class="empty-state">Select a scene to read its script.</div>' : `<article class="script-page" id="script-text">${scriptHTML(b)}</article>`}</div><div class="panel-footer"><span>${esc(project._scriptFilename || 'Scene script')}</span><span>${b?`p. ${esc(b.scriptPage || '—')}`:''}</span></div></section>`;
}
function scriptHTML(b) {
  if (!b._scriptText) return `<p class="slug">${esc(slug(b))}</p><p class="action">Script text is not included in this scene. Use Edit text to add it. USS files carry breakdown data; full script text is retained in Production Desk backups.</p>`;
  let dialogue = false;
  return b._scriptText.split('\n').map((line,i)=> {
    const cue = line.trim(), heading = /^(?:\d+[A-Z]?\s+)?\.?((INT|EXT)[./]|I\/E)/i.test(cue);
    let cls = 'action';
    if (heading) { cls='slug'; dialogue=false; }
    else if (!cue) { dialogue=false; }
    else if (/^[A-Z][A-Z0-9 .()'’\-/]+$/.test(cue) && cue.length<40 && !cue.endsWith(':')) { cls='character';dialogue=true; }
    else if (cue.startsWith('(')) cls='paren';
    else if (dialogue) cls='dialogue';
    return `<p class="${cls}">${esc(line)}</p>`;
  }).join('');
}
function field(label, key, value, type='text', wide=false, attributes='') { return `<label class="field ${wide?'wide':''}">${label}<input data-field="${key}" type="${type}" value="${esc(value)}" ${attributes}></label>`; }
function propertyField(label, ucid, b, choices) { const val=prop(b,ucid); return `<label class="field">${label}${choices ? `<select data-prop="${ucid}">${[...new Set([...choices,...(val?[val]:[])])].map(v=>`<option ${v===val?'selected':''}>${esc(v)}</option>`).join('')}</select>` : `<input data-prop="${ucid}" value="${esc(val)}">`}</label>`; }
function breakdownPanel() {
  const b=breakdown();
  if (!b) return `<section class="panel"><div class="panel-header"><div class="panel-title">Breakdown sheet</div></div>${emptyPanel('Your scene details and production elements will live here.')}</section>`;
  if (b.type==='banner') return `<section class="panel"><div class="panel-header"><div class="panel-title">Banner</div></div><div class="sheet-bottom">${field('Banner text','bannerText',b.bannerText)}<button data-action="delete-scene" class="danger">Delete banner</button></div></section>`;
  const visibleCats=project.categories.filter(c=>c.ucid>=100 && ([100,101,102,103,104,106,107,105,119,121].includes(c.ucid) || project.elements.some(e=>e.category===c.id&&b.elements.includes(e.id))));
  return `<section class="panel"><div class="panel-header"><div class="panel-title"><span class="symbol">◇</span>Breakdown sheet</div><span class="tiny">SCENE ${esc(b.scene)}</span></div><div class="breakdown-scroll">
    <div class="scene-strip-preview ${stripClass(b)} ${validStripColor(b._stripColor)?'custom-color':''}" ${customStripAttrs(b)}><span class="scene-big-number">${esc(b.scene)}</span><div><div class="preview-heading">${esc(slug(b))}</div><div class="preview-desc">${pages(b.pages)} pages · ${minutes(b.duration)} estimated</div></div></div>
    ${b._needsReview?'<div class="notice">Imported page count and cast are estimates. Review this sheet, then mark it reviewed below.</div>':''}
    <div class="fields"><div class="form-grid">${field('Scene number','scene',b.scene)}${field('Script page','scriptPage',b.scriptPage)}${propertyField('INT / EXT',1,b,['INT','EXT','I/E'])}${propertyField('Time of day',2,b,['Day','Night','Dawn','Dusk'])}${propertyField('Set',0,b)}${propertyField('Shoot location',6,b)}${field('Pages (decimal eighths)','pages',b.pages,'number',false,'min="0" step="0.125"')}${field('Shoot time (minutes)','duration',(b.duration||0)/60000,'number',false,'min="0" step="5"')}${propertyField('Script day',3,b)}${propertyField('Unit',4,b)}<label class="field wide">Synopsis<textarea data-field="description">${esc(b.description)}</textarea></label></div></div>
    <div class="divider-title">PRODUCTION ELEMENTS <span>${b.elements.filter(eid=>project.categories.find(c=>c.id===project.elements.find(e=>e.id===eid)?.category)?.ucid>=100).length} tagged</span></div>
    <div class="category-list">${visibleCats.map(c=>categoryCard(c,b)).join('')}<div class="element-entry"><select id="extra-category" aria-label="Additional element category">${project.categories.filter(c=>c.ucid>=100&&!visibleCats.includes(c)).map(c=>`<option value="${c.ucid}">${esc(c.name)}</option>`).join('')}</select><button data-action="extra-element">＋</button></div></div>
    <div class="sheet-bottom"><label class="field">Production notes<textarea data-field="comments">${esc(b.comments)}</textarea></label><label class="check-label"><input type="checkbox" id="reviewed" ${b._needsReview?'':'checked'}>Breakdown reviewed</label><label class="check-label"><input type="checkbox" data-field="_completed" ${b._completed?'checked':''}>Scene completed</label><div class="sheet-actions"><select id="move-target" aria-label="Move scene to shooting day"><option value="unscheduled">Unscheduled</option>${scheduleGroups().map((g,i)=>Array.isArray(g)?`<option value="${i}">Shoot day ${dayOrdinal(i)}</option>`:'').join('')}</select><button data-action="move-scene">Move scene</button><button data-action="delete-scene" class="danger" title="Delete selected scene" aria-label="Delete selected scene">×</button></div></div>
    </div></section>`;
}
function categoryCard(c,b) {
  const elements = project.elements.filter(e=>e.category===c.id&&b.elements.includes(e.id));
  return `<div class="category-card"><div class="category-heading"><span class="category-dot"></span>${esc(c.name)}<span class="tiny">${elements.length || '—'}</span></div><div class="chips">${elements.map(e=>`<span class="chip">${e.elementId?esc(e.elementId)+' · ':''}${esc(e.name)}<button data-remove-element="${esc(e.id)}" aria-label="Remove ${esc(e.name)}">×</button></span>`).join('')}</div><form class="element-entry" data-add-category="${c.ucid}"><input placeholder="Add ${esc(c.name.toLowerCase())}…" aria-label="Add ${esc(c.name)}" list="elements-${c.ucid}"><datalist id="elements-${c.ucid}">${project.elements.filter(e=>e.category===c.id).map(e=>`<option value="${esc(e.name)}">`).join('')}</datalist><button aria-label="Add element">＋</button></form></div>`;
}
function dayOrdinal(index) { return scheduleGroups().slice(0,index+1).filter(Array.isArray).length; }
function scenarioSelect() { return `<select id="scenario-picker" aria-label="Schedule scenario">${project.stripboards.map((s,i)=>`<option value="${i}" ${i===scenarioIndex?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`; }
function boardPanel(full=false) {
  return `<section class="panel board-panel"><div class="panel-header"><div class="panel-title"><span class="symbol">▦</span>Stripboard <span class="count">${allScheduled().length} strips</span></div><button class="text-button" data-action="calendar-settings">Calendar</button></div><div class="board-toolbar">${scenarioSelect()}<button data-action="new-scenario" title="Duplicate this scenario" aria-label="Duplicate scenario">⧉</button><button data-action="add-day">＋ Day</button><button data-action="add-banner">＋ Banner</button></div><div class="board-scroll">${boardHTML()}${full?'':boneyardHTML()}</div>${legend()}<div class="panel-footer"><span>Drag strips between days</span><span>${pages(totals(allScheduled()).pages)} pages scheduled</span></div></section>`;
}
function legend() { return '<div class="board-legend"><span><i></i>INT / DAY</span><span class="ext"><i></i>EXT / DAY</span><span class="night"><i></i>NIGHT</span><span class="dusk"><i></i>DAWN / DUSK</span></div>'; }
function boardHTML() {
  const groups=scheduleGroups(), shootingDates=dates(groups.filter(Array.isArray).length); let ordinal=0;
  if (!groups.length) return '<div class="empty-state"><h3>Make room for day one.</h3>Add a shooting day, then drag in scenes from Unscheduled.<br><button data-action="add-day">＋ Add first day</button></div>';
  return groups.map((group,i)=>{
    if (!Array.isArray(group)) return stripHTML(group,'main',i);
    const date=shootingDates[ordinal++], t=totals(group), conflict=availabilityConflicts(group,date);
    return `<section class="day-block"><div class="day-header"><strong>DAY ${String(ordinal).padStart(2,'0')} <span> / ${esc(dateLabel(date))}</span></strong><div><button data-sort-day="${i}" title="Sort by set" aria-label="Sort day ${ordinal} by set">↕</button><button data-remove-day="${i}" title="Remove day; return scenes to Unscheduled" aria-label="Remove day ${ordinal}">×</button></div></div><div class="drop-zone" data-zone="day" data-index="${i}">${group.map((bid,n)=>stripHTML(bid,'day',i,n)).join('')}${group.length?'':'<div class="empty-drop">Drop scenes here</div>'}</div><div class="day-total ${conflict.length?'warn':''}">${conflict.length?`Unavailable: ${esc(conflict.join(', '))} · `:''}${t.scenes} scenes · ${pages(t.pages)} pages · ${minutes(t.duration)}</div></section>`;
  }).join('');
}
function stripHTML(bid, zone, index, position) {
  const b=breakdown(bid); if(!b) return '';
  const grip=isIPadApp?`<button class="strip-move-button" data-move-strip="${esc(b.id)}" aria-label="Move ${b.type==='banner'?'banner':'scene '+esc(b.scene)}">↕</button>`:'<span class="grip">⠿</span>';
  const attrs=`draggable="true" tabindex="0" data-strip="${esc(b.id)}" data-origin="${zone}" data-index="${index}" ${position!==undefined?`data-position="${position}"`:''}`;
  if(b.type==='banner') return `<div class="strip banner ${b.id===selected?'selected':''} ${validStripColor(b._stripColor)?'custom-color':''}" ${attrs} ${customStripAttrs(b)}>${grip}<div class="strip-heading">${esc(b.bannerText)}</div>${stripColorButton(b)}</div>`;
  return `<div class="strip ${stripClass(b)} ${b.id===selected?'selected':''} ${b._completed?'completed':''} ${validStripColor(b._stripColor)?'custom-color':''}" ${attrs} ${customStripAttrs(b)}>${grip}<span class="strip-number">${esc(b.scene)}</span><div><div class="strip-heading">${esc(slug(b))}</div><div class="strip-description">${esc(b.description || 'Add a scene synopsis')}</div><div class="strip-meta">CAST ${items(b,100).map(e=>esc(e.elementId || e.name)).join(', ') || '—'} ${b._completed?' · COMPLETE':''}</div></div><span class="strip-pages">${pages(b.pages)}</span>${stripColorButton(b)}</div>`;
}
function moveStripModal(bid){
  const b=breakdown(bid),targets=[{zone:'main',index:0,name:'Between shooting days',ids:activeBoard().breakdownIds}];
  scheduleGroups().forEach((g,index)=>{if(Array.isArray(g))targets.push({zone:'day',index,name:'Shoot day '+dayOrdinal(index),ids:g});});
  activeScenario().boards.slice(1).forEach((board,i)=>targets.push({zone:'board',index:i+1,name:i===0?'Unscheduled':board.name,ids:board.breakdownIds.flat()}));
  const initial=targets.findIndex(t=>t.ids.includes(bid));
  modal('Move '+(b.type==='banner'?'banner':'scene '+esc(b.scene)),`<p>Choose a destination and where the strip should appear.</p><label class="field">Destination<select id="strip-move-target">${targets.map((t,i)=>`<option value="${i}" ${i===initial?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label class="field">Position<select id="strip-move-before"></select></label>`,'<button id="modal-cancel">Cancel</button><button id="strip-move-save" class="primary">Move strip</button>');
  const positions=()=>{const target=targets[Number($('#strip-move-target').value)];$('#strip-move-before').innerHTML='<option value="">At the end</option>'+target.ids.map((x,i)=>{if(x===bid)return '';const item=typeof x==='string'?breakdown(x):null,label=Array.isArray(x)?'shoot day '+target.ids.slice(0,i+1).filter(Array.isArray).length:item.type==='banner'?item.bannerText:'scene '+item.scene+' · '+prop(item,0);return `<option value="${i}">Before ${esc(label)}</option>`;}).join('');};
  $('#strip-move-target').onchange=positions;positions();
  $('#strip-move-save').onclick=()=>{const target=targets[Number($('#strip-move-target').value)],before=$('#strip-move-before').value;mutate(()=>moveScene(bid,target.zone,target.index,before===''?undefined:Number(before)));$('#modal').close();toast('Strip moved.');};
}
function stripColorButton(b){return `<button class="strip-color-button" data-color-strip="${esc(b.id)}" title="Change strip color" aria-label="Change color for ${b.type==='banner'?'banner':`scene ${esc(b.scene)}`}">◐</button>`;}
function boneyardHTML() {
  const boards=activeScenario()?.boards || [];
  return boards.slice(1).map((board,i)=>`<div class="boneyard-header"><span>${i===0?'UNSCHEDULED':esc(board.name.toUpperCase())}</span><span>${board.breakdownIds.flat().length} strips</span></div><div class="boneyard drop-zone" data-zone="board" data-index="${i+1}">${board.breakdownIds.flat().map((bid,n)=>stripHTML(bid,'board',i+1,n)).join('')}${board.breakdownIds.length?'':'<div class="empty-drop">Drop scenes here to unschedule</div>'}</div>`).join('');
}
function scheduleView() {
  return `<div class="schedule-layout">${boardPanel(true)}<section class="panel"><div class="panel-header"><div class="panel-title">Holding board</div><span class="tiny">DRAG TO SCHEDULE</span></div><div class="board-scroll">${boneyardHTML()}</div><div class="panel-footer">Select a strip to open its breakdown.</div></section></div>`;
}
function availabilityConflicts(ids,date) {
  if(!date) return []; const weekday=new Date(date+'T12:00:00Z').getUTCDay();
  const used=new Set(ids.flatMap(bid=>breakdown(bid)?.elements || []));
  return project.elements.filter(e=>used.has(e.id)&&((e.daysOff||[]).includes(weekday)||(e.events||[]).some(event=>event.type==='dayOff'&&event.date.slice(0,10)===date))).map(e=>e.name);
}
function elementsView() {
  const filtered=project.elements.filter(e=> (!elementCategory || e.category===elementCategory) && e.name.toLowerCase().includes(elementSearch.toLowerCase()));
  return `<section class="panel wide-panel"><div class="panel-header"><div class="panel-title">Production elements <span class="count">${project.elements.length}</span></div><button class="text-button" data-action="new-element">＋ New element</button></div><div class="table-tools"><input id="element-search" placeholder="Search production elements…" value="${esc(elementSearch)}"><select id="element-filter"><option value="">All categories</option>${project.categories.map(c=>`<option value="${esc(c.id)}" ${c.id===elementCategory?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="table-wrap"><table><thead><tr><th>Board ID</th><th>Element</th><th>Category</th><th>In scenes</th><th>Availability</th><th class="element-actions-heading">Actions</th></tr></thead><tbody>${filtered.map(e=>`<tr data-production-element="${esc(e.id)}"><td><input data-element-id="${esc(e.id)}" value="${esc(e.elementId)}" aria-label="Board ID for ${esc(e.name)}"></td><td><input class="element-name" data-element-name="${esc(e.id)}" value="${esc(e.name)}" aria-label="Name for ${esc(e.name)}"></td><td>${esc(project.categories.find(c=>c.id===e.category)?.name)}</td><td>${sceneList().filter(b=>b.elements.includes(e.id)).map(b=>esc(b.scene)).join(', ') || '—'}</td><td><button class="text-button" data-availability="${esc(e.id)}">${(e.daysOff?.length || e.events?.length)?'Manage days off':'Set days off'} ↗</button></td><td class="element-actions-cell"><button data-element-menu aria-label="Actions for ${esc(e.name)}" title="Element actions">⋯</button></td></tr>`).join('')}</tbody></table>${filtered.length?'':'<div class="view-empty">No matching elements.</div>'}</div><div class="panel-footer">Renaming an element updates it in every scene. Right-click an element or use ⋯ to delete it. You can undo deletions.</div></section>`;
}
function reportsView() {
  const t=totals(allScheduled()), dayCount=scheduleGroups().filter(Array.isArray).length;
  return `<div class="overview-cards"><div class="overview-card"><strong>${pages(t.pages)}</strong><span>Pages on the shooting board</span></div><div class="overview-card"><strong>${minutes(t.duration)}</strong><span>Total estimated shoot time</span></div><div class="overview-card"><strong>${dayCount?pages(t.pages/dayCount):'—'}</strong><span>Average pages per shooting day</span></div></div><section class="panel"><div class="report-tabs"><button data-report="oneline" class="${report==='oneline'?'active':''}">One-line schedule</button><button data-report="dood" class="${report==='dood'?'active':''}">Cast workdays</button><button data-report="breakdowns" class="${report==='breakdowns'?'active':''}">Scene breakdowns</button><button data-action="print" class="print-btn">Print / Save PDF</button></div><div class="table-wrap" id="report-table">${reportHTML()}</div><div class="report-note">${report==='dood'?'SW = first workday · W = workday · WF = last workday · SWF = works one day · — = no scheduled work. This report lists workdays only; hold, drop, and pickup rules are not calculated.':'Times are estimates entered in your scene breakdowns. Review your board before issuing a production schedule.'}</div></section>`;
}
function reportHTML() {
  if(report==='dood') {
    const groups=scheduleGroups().filter(Array.isArray), ds=dates(groups.length), cast=project.elements.filter(e=>e.category===category(100)?.id);
    return `<table><thead><tr><th>Cast</th>${groups.map((g,i)=>`<th>Day ${i+1}<br>${esc(dateLabel(ds[i]))}</th>`).join('')}<th>Days</th></tr></thead><tbody>${cast.map(e=>{const work=groups.map(g=>g.some(bid=>breakdown(bid)?.elements.includes(e.id)));const first=work.indexOf(true),last=work.lastIndexOf(true);return `<tr><td>${esc(e.elementId || '')} · ${esc(e.name)}</td>${work.map((yes,i)=>`<td class="dood-cell">${yes?(first===last?'SWF':i===first?'SW':i===last?'WF':'W'):'—'}</td>`).join('')}<td>${work.filter(Boolean).length}</td></tr>`;}).join('')}</tbody></table>`;
  }
  if(report==='breakdowns') return `<table><thead><tr><th>Scene</th><th>Heading</th><th>Synopsis</th><th>Pages</th><th>Elements / notes</th></tr></thead><tbody>${sceneList().map(b=>`<tr><td>${esc(b.scene)}</td><td>${esc(slug(b))}</td><td>${esc(b.description)}</td><td>${pages(b.pages)}</td><td>${project.categories.filter(c=>c.ucid>=100).map(c=>{const names=project.elements.filter(e=>e.category===c.id&&b.elements.includes(e.id)).map(e=>esc(e.name));return names.length?`<b>${esc(c.name)}:</b> ${names.join(', ')}<br>`:'';}).join('')}${b.comments?`<br>${esc(b.comments)}`:''}</td></tr>`).join('')}</tbody></table>`;
  const groups=scheduleGroups(), ds=dates(groups.filter(Array.isArray).length); let day=0;
  return `<table><thead><tr><th>Day / Date</th><th>Scene</th><th>Heading / Synopsis</th><th>Pages</th><th>Est. time</th><th>Cast</th><th>Location</th></tr></thead><tbody>${groups.map(g=>{let label='Unassigned'; if(Array.isArray(g)) label=`Day ${++day} / ${dateLabel(ds[day-1])}`;return (Array.isArray(g)?g:[g]).map(bid=>{const b=breakdown(bid); if(!b)return '';return `<tr><td>${esc(label)}</td><td>${esc(b.scene || '—')}</td><td><b>${esc(b.type==='banner'?b.bannerText:slug(b))}</b><br>${esc(b.description)}</td><td>${b.type==='scene'?pages(b.pages):''}</td><td>${b.type==='scene'?minutes(b.duration):''}</td><td>${esc(prop(b,100))}</td><td>${esc(prop(b,6))}</td></tr>`;}).join('');}).join('')}</tbody></table>`;
}

function removeFromScenario(s,bid) {
  for(const board of s.boards)for(let i=board.breakdownIds.length-1;i>=0;i--){const group=board.breakdownIds[i];if(Array.isArray(group)){for(let j=group.length-1;j>=0;j--)if(group[j]===bid)group.splice(j,1);}else if(group===bid)board.breakdownIds.splice(i,1);}
}
function moveScene(bid, zone, index, position) {
  const s=activeScenario(); let target;
  if(zone==='day') target=activeBoard().breakdownIds[index];
  else if(zone==='board') { const board=s.boards[index]; board.breakdownIds=board.breakdownIds.flat(); target=board.breakdownIds; }
  else target=activeBoard().breakdownIds;
  if(!Array.isArray(target)) return;
  let at=position===undefined?target.length:position;
  const previous=target.indexOf(bid); if(previous!==-1&&previous<at) at--;
  removeFromScenario(s,bid);
  // Keep the destination reference: removing a banner before a day can change
  // that day's board index, while its array remains the same destination.
  target.splice(Math.max(0,at),0,bid);
}
function bindContent() {
  if(view==='shots')shotDesk.bind();
  $$('[data-action]').forEach(b=>b.addEventListener('click',()=>action(b.dataset.action)));
  $('#scene-picker')?.addEventListener('change',e=>{selected=e.target.value;render();});
  $('#scene-search')?.addEventListener('input',e=>{search=e.target.value;const value=search,caret=e.target.selectionStart;render();const input=$('#scene-search');input.focus();input.setSelectionRange(caret,caret);});
  $('#scenario-picker')?.addEventListener('change',e=>{scenarioIndex=Number(e.target.value);render();});
  // Save text as it is entered. Avoid replacing the focused input on blur,
  // which can swallow a click on the next field or scene-navigation button.
  $$('[data-field], [data-prop]').forEach(input=>{
    let editing=false;
    const update=()=>{
      if(!input.checkValidity())return;
      if(!editing){history.push(clone(workspace));if(history.length>40)history.shift();future=[];editing=true;}
      const b=breakdown();
      if(input.dataset.prop)setProp(b,Number(input.dataset.prop),input.value);
      else {let value=input.type==='checkbox'?input.checked:input.value;if(['pages','duration'].includes(input.dataset.field))value=Number(value)*(input.dataset.field==='duration'?60000:1);b[input.dataset.field]=value;}
      mark();updateUndo();syncReadouts();
    };
    input.addEventListener('input',update);
    input.addEventListener('change',()=>{update();editing=false;});
    input.addEventListener('blur',()=>{editing=false;});
  });
  $('#reviewed')?.addEventListener('change',e=>mutate(()=>breakdown()._needsReview=!e.target.checked));
  $$('[data-add-category]').forEach(form=>form.addEventListener('submit',e=>{e.preventDefault();const name=$('input',form).value;if(name.trim())mutate(()=>addElement(breakdown(),Number(form.dataset.addCategory),name));}));
  $$('[data-remove-element]').forEach(button=>button.addEventListener('click',()=>mutate(()=>{breakdown().elements=breakdown().elements.filter(x=>x!==button.dataset.removeElement);})));
  $('#script-text')?.addEventListener('mouseup',()=>{const selection=window.getSelection();if(selection&&$('#script-text').contains(selection.anchorNode))selectedText=selection.toString().trim();});
  $('#tag-selection')?.addEventListener('click',()=>{if(!selectedText)return toast('Select a name or object in the script first.');if(selectedText.length>120)return toast('Select a shorter name (up to 120 characters).');const text=selectedText;mutate(()=>addElement(breakdown(),Number($('#tag-category').value),text));selectedText='';toast(`Tagged “${text}”`);});
  $$('[data-color-strip]').forEach(button=>button.addEventListener('click',e=>{e.stopPropagation();stripColorModal(button.dataset.colorStrip);}));
  $$('[data-move-strip]').forEach(button=>button.addEventListener('click',e=>{e.stopPropagation();moveStripModal(button.dataset.moveStrip);}));
  $$('[data-strip]').forEach(strip=>{
    strip.addEventListener('click',e=>{if(e.target.closest('[data-color-strip],[data-move-strip]'))return;selected=strip.dataset.strip;if(view==='schedule')view='workspace';render();});
    strip.addEventListener('keydown',e=>{if(e.target.closest('[data-color-strip],[data-move-strip]'))return;if(e.key==='Enter'){selected=strip.dataset.strip;view='workspace';render();}});
    strip.addEventListener('dragstart',e=>{dragging=strip.dataset.strip;e.dataTransfer.setData('text/plain',dragging);e.dataTransfer.effectAllowed='move';});
    strip.addEventListener('dragend',()=>{dragging=null;$$('.drag-over').forEach(el=>el.classList.remove('drag-over'));});
    strip.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();e.stopPropagation();strip.classList.add('drag-over');});
    strip.addEventListener('dragleave',()=>strip.classList.remove('drag-over'));
    strip.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();const bid=dragging;if(bid&&breakdown(bid))mutate(()=>moveScene(bid,strip.dataset.origin,Number(strip.dataset.index),strip.dataset.position===undefined?Number(strip.dataset.index):Number(strip.dataset.position)));dragging=null;});
  });
  $$('[data-zone]').forEach(zone=>{
    zone.addEventListener('dragover',e=>{if(!dragging)return;e.preventDefault();zone.classList.add('drag-over');});
    zone.addEventListener('dragleave',e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('drag-over');});
    zone.addEventListener('drop',e=>{e.preventDefault();const bid=dragging;if(bid&&breakdown(bid))mutate(()=>moveScene(bid,zone.dataset.zone,Number(zone.dataset.index)));dragging=null;});
  });
  $$('[data-remove-day]').forEach(button=>button.addEventListener('click',()=>mutate(()=>{const group=activeBoard().breakdownIds.splice(Number(button.dataset.removeDay),1)[0];boneyard().breakdownIds.push(...group);})));
  $$('[data-sort-day]').forEach(button=>button.addEventListener('click',()=>mutate(()=>activeBoard().breakdownIds[Number(button.dataset.sortDay)].sort((a,b)=>slug(breakdown(a)).localeCompare(slug(breakdown(b)),undefined,{numeric:true})))));
  $('#element-search')?.addEventListener('input',e=>{elementSearch=e.target.value;const caret=e.target.selectionStart;render();$('#element-search').focus();$('#element-search').setSelectionRange(caret,caret);});
  $('#element-filter')?.addEventListener('change',e=>{elementCategory=e.target.value;render();});
  $$('[data-element-name]').forEach(input=>{
    const update=()=>{const value=input.value.trim(),e=project.elements.find(e=>e.id===input.dataset.elementName);if(value&&e.name!==value)mutate(()=>e.name=value,false);};
    input.addEventListener('input',update);
    input.addEventListener('change',()=>{if(!input.value.trim())render();else update();});
  });
  $$('[data-element-id]').forEach(input=>{
    const update=()=>{const e=project.elements.find(e=>e.id===input.dataset.elementId),value=input.value||null;if(e.elementId!==value)mutate(()=>e.elementId=value,false);};
    input.addEventListener('input',update);input.addEventListener('change',update);
  });
  if(view==='elements')elementActions.bind($('#content'));
  $$('[data-availability]').forEach(button=>button.addEventListener('click',()=>availabilityModal(button.dataset.availability)));
  $$('[data-report]').forEach(button=>button.addEventListener('click',()=>{report=button.dataset.report;render();}));
}

function syncReadouts(){
  const b=breakdown();
  if($('.preview-heading'))$('.preview-heading').textContent=slug(b);
  if($('.preview-desc'))$('.preview-desc').textContent=`${pages(b.pages)} pages · ${minutes(b.duration)} estimated`;
  if($('.scene-big-number'))$('.scene-big-number').textContent=b.scene;
  $$('[data-strip]').forEach(strip=>{const s=breakdown(strip.dataset.strip);if(!s||s.type==='banner')return;$('.strip-number',strip).textContent=s.scene;$('.strip-heading',strip).textContent=slug(s);$('.strip-description',strip).textContent=s.description || 'Add a scene synopsis';$('.strip-pages',strip).textContent=pages(s.pages);});
}

function action(name) {
  if(name==='import')return importModal();
  if(name==='prev'||name==='next') {const scenes=sceneList(),i=scenes.findIndex(b=>b.id===selected);selected=scenes[(i+(name==='next'?1:-1)+scenes.length)%scenes.length]?.id;render();}
  if(name==='add-day')mutate(()=>activeBoard().breakdownIds.push([]));
  if(name==='calendar-settings')settingsModal();
  if(name==='move-scene'){const value=$('#move-target').value;mutate(()=>moveScene(selected,value==='unscheduled'?'board':'day',value==='unscheduled'?1:Number(value)));toast('Scene moved.');}
  if(name==='delete-scene')confirmModal('Delete this '+(breakdown().type==='banner'?'banner':'scene')+'?', 'This removes its breakdown, linked shots, and strips from every scenario. You can undo this change.',()=>mutate(()=>{for(const s of project.stripboards)removeFromScenario(s,selected);project._shots=project._shots.filter(s=>s.sceneId!==selected);project.breakdowns=project.breakdowns.filter(b=>b.id!==selected);selected=sceneList()[0]?.id;}));
  if(name==='new-scenario')textModal('Duplicate schedule','Scenario name',activeScenario().name+' · alternate',value=>mutate(()=>{const s=clone(activeScenario());s.id=id();s.name=value;s.boards.forEach(b=>b.id=id());project.stripboards.push(s);scenarioIndex=project.stripboards.length-1;}));
  if(name==='add-banner')textModal('Add a board banner','Banner text','Company move',value=>mutate(()=>{const b={id:id(),bannerText:value,comments:null,created:stamp(),description:null,elements:[],pages:null,scene:null,scriptPage:null,duration:null,type:'banner'};project.breakdowns.push(b);for(const s of project.stripboards)s.boards[1].breakdownIds.push(b.id);selected=b.id;}));
  if(name==='edit-script')scriptEditModal();
  if(name==='extra-element'){const ucid=Number($('#extra-category').value);if(!ucid)return;const c=category(ucid);textModal('Add '+c.name,'Element name','',value=>mutate(()=>addElement(breakdown(),ucid,value)));}
  if(name==='new-element')newElementModal();
  if(name==='print'&&view==='shots')return shotDesk.print();
  if(name==='print'){ $('#print-area').innerHTML=`<h1>${esc(project.project || project.name)}</h1><p>${esc(activeScenario().name)} · ${report==='dood'?'Cast workdays':report==='breakdowns'?'Scene breakdowns':'One-line shooting schedule'}</p>${reportHTML()}`;applyStripColors($('#print-area'));window.print(); }
}

function modal(title, body, footer='') {
  $('#modal-content').innerHTML=`<div class="modal-header"><h2>${title}</h2><button id="modal-close" aria-label="Close dialog">×</button></div><div class="modal-body">${body}<div id="modal-error" class="modal-error" role="alert"></div></div>${footer?`<div class="modal-footer">${footer}</div>`:''}`;
  $('#modal-close').onclick=()=>$('#modal').close();
  if(!$('#modal').open)$('#modal').showModal();
  $('#modal-cancel')?.addEventListener('click',()=>$('#modal').close());
}
function textModal(title,label,initial,callback) {
  modal(title,field(label,'modal-value',initial),'<button id="modal-cancel">Cancel</button><button id="modal-ok" class="primary">Create</button>');
  const input=$('[data-field="modal-value"]');input.focus();input.select();
  const submit=()=>{const value=input.value.trim();if(!value)return;callback(value);$('#modal').close();};
  $('#modal-ok').onclick=submit;input.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
}
function confirmModal(title,message,callback) { modal(title,`<p>${esc(message)}</p>`,'<button id="modal-cancel">Cancel</button><button id="modal-ok" class="danger">Delete</button>');$('#modal-ok').onclick=()=>{callback();$('#modal').close();}; }
function importModal() {
  modal('Bring your story in',`<p>Import creates a separate production, keeping your existing work. All parsing happens on this device.</p><label class="file-drop"><strong>Choose a script or schedule</strong><span>PDF · Final Draft (.fdx) · Fountain · TXT · USS</span><input type="file" id="import-file" accept=".pdf,.fdx,.fountain,.txt,.uss,.json"><span>PDFs need selectable text. Scans require a text layer.</span></label><div class="or-divider">OR PASTE A SCREENPLAY</div><textarea id="paste-script" class="paste-script" placeholder="INT. KITCHEN - DAY&#10;&#10;The kettle whistles.&#10;&#10;MAYA&#10;We're going to be late."></textarea><p class="tiny">Scene lengths and cast detection should be reviewed after import. Workspace JSON backups restore as separate productions.</p>`,'<button id="modal-cancel">Cancel</button><button id="import-submit" class="primary">Import locally</button>');
  $('#import-submit').onclick=async()=>{
    const button=$('#import-submit'), file=$('#import-file').files[0], text=$('#paste-script').value;
    if(!file&&!text.trim()){ $('#modal-error').textContent='Choose a file or paste script text.';return; }
    button.disabled=true;button.textContent=file?.name.toLowerCase().endsWith('.pdf')?'Reading PDF locally…':'Importing…';
    try {
      const result=await api('/api/import',file || text,{'X-Filename':encodeURIComponent(file?.name || 'Pasted script.txt')});
      const incoming=result.workspace?result.workspace.projects:[result.project];
      if(!incoming?.length)throw new Error('This backup has no productions.');
      // Retain IDs when possible; duplicate imports get remapped in one pass.
      const known=new Set(workspace.projects.map(p=>p.id));
      const imported=incoming.map(p=>{normalize(p);if(known.has(p.id))p=remapIds(p);known.add(p.id);return p;});
      mutate(()=>{workspace.projects.push(...imported);workspace.activeProject=imported[0].id;scenarioIndex=0;selected=undefined;view='workspace';});
      $('#modal').close();toast(`Imported ${imported[0].breakdowns.filter(b=>b.type==='scene').length} scenes. Your existing productions are preserved.`);
    }catch(e){$('#modal-error').textContent=e.message;button.disabled=false;button.textContent='Import locally';}
  };
}
function remapIds(p) {
  const map=new Map();
  function gather(value){if(Array.isArray(value))value.forEach(gather);else if(value&&typeof value==='object'){if(typeof value.id==='string')map.set(value.id,id());Object.values(value).forEach(gather);}}
  function replace(value){if(typeof value==='string')return map.get(value)||value;if(Array.isArray(value))return value.map(replace);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,replace(v)]));return value;}
  gather(p);const copy=replace(p);copy.project=(copy.project || copy.name)+' · imported copy';return copy;
}
function stripColorModal(bid){
  const b=breakdown(bid);if(!b)return;
  let chosen=validStripColor(b._stripColor)?b._stripColor.toUpperCase():null;
  modal('Strip color · '+esc(b.type==='banner'?'Banner':`Scene ${b.scene}`),`<p>Choose a color for this strip. The same scene uses this color in every schedule scenario. Automatic restores the usual INT/EXT and time-of-day colors.</p><div class="strip-palette">${STRIP_PALETTE.map(([name,color])=>`<button class="strip-swatch" data-swatch-color="${color}" aria-label="${name}" title="${name}" aria-pressed="${chosen===color}"><span data-strip-color="${color}">${chosen===color?'✓':''}</span>${name}</button>`).join('')}</div><div class="strip-custom-fields"><label class="field">Custom color<input id="strip-color-picker" type="color" value="${chosen||'#E60026'}"></label><label class="field">Hex color<input id="strip-color-hex" value="${chosen||'#E60026'}" maxlength="7" pattern="#[a-fA-F0-9]{6}" aria-label="Hex color"></label></div><div class="strip-color-preview" id="strip-color-preview"><strong>${esc(b.type==='banner'?b.bannerText:`SCENE ${b.scene}`)}</strong><span>${esc(b.type==='banner'?'Board banner':slug(b))}</span></div>`,'<button id="strip-color-auto">Automatic</button><button id="modal-cancel">Cancel</button><button class="primary" id="strip-color-save">Apply color</button>');
  const preview=$('#strip-color-preview');
  const update=(color)=>{chosen=color.toUpperCase();$('#strip-color-picker').value=chosen;$('#strip-color-hex').value=chosen;$('#modal-error').textContent='';preview.style.backgroundColor=chosen;preview.style.color=stripTextColor(chosen);$$('[data-swatch-color]').forEach(button=>{const active=button.dataset.swatchColor===chosen;button.setAttribute('aria-pressed',active);$('span',button).textContent=active?'✓':'';});};
  applyStripColors($('#modal-content'));update(chosen||'#E60026');
  $$('[data-swatch-color]').forEach(button=>button.onclick=()=>update(button.dataset.swatchColor));
  $('#strip-color-picker').oninput=e=>update(e.target.value);
  $('#strip-color-hex').oninput=e=>{if(validStripColor(e.target.value))update(e.target.value);};
  $('#strip-color-save').onclick=()=>{const hex=$('#strip-color-hex').value.trim();if(!validStripColor(hex)){$('#modal-error').textContent='Enter a six-digit hex color, such as #E60026.';return;}mutate(()=>b._stripColor=hex.toUpperCase());$('#modal').close();};
  $('#strip-color-auto').onclick=()=>{mutate(()=>delete b._stripColor);$('#modal').close();};
}

function scriptEditModal() {const b=breakdown();modal('Edit scene text',`<p>Editing this text does not change your breakdown fields or retag elements. Use the breakdown sheet to update those separately.</p><textarea id="edit-text" class="paste-script">${esc(b._scriptText || slug(b))}</textarea>`,'<button id="modal-cancel">Cancel</button><button id="edit-submit" class="primary">Save scene text</button>');$('#edit-submit').onclick=()=>{const text=$('#edit-text').value;mutate(()=>b._scriptText=text);$('#modal').close();};}
function newScene() {
  textModal('Add a scene','Scene number',String(sceneList().length+1),number=>mutate(()=>{
    const b={id:id(),bannerText:null,comments:null,created:stamp(),description:'',elements:[],pages:.125,scene:number,scriptPage:'1',duration:3600000,type:'scene',_scriptText:'',_needsReview:false};
    project.breakdowns.push(b);addElement(b,1,'INT');addElement(b,2,'Day');addElement(b,0,'UNTITLED SET');
    for(const s of project.stripboards)s.boards[1].breakdownIds.push(b.id);
    selected=b.id;view='workspace';
  }));
}
function newElementModal() {
  modal('New production element',`<div class="form-grid"><label class="field wide">Category<select id="new-element-category">${project.categories.map(c=>`<option value="${c.ucid}">${esc(c.name)}</option>`).join('')}</select></label>${field('Element name','new-element-name','', 'text',true)}</div>`,'<button id="modal-cancel">Cancel</button><button class="primary" id="new-element-submit">Create element</button>');
  $('#new-element-submit').onclick=()=>{const name=$('[data-field="new-element-name"]').value.trim(),ucid=Number($('#new-element-category').value);if(!name)return;mutate(()=>addElement({elements:[]},ucid,name));$('#modal').close();};
}
function settingsModal() {
  const c=calendar(),start=c?.events.find(e=>e.type==='start')?.date.slice(0,10) || '';
  modal('Production settings',`<div class="form-grid">${field('Production title','title',project.project || project.name,'text',true)}${field('Schedule name','schedule-name',project.name)}${field('Author','author',project.author)}${field('Company','company',project.company)}${field('First shooting date','start-date',start,'date')}</div><div class="section-label">WEEKLY DAYS OFF</div><div class="weekday-row">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=>`<label><input type="checkbox" name="days-off" value="${i}" ${(c?.daysOff || []).includes(i)?'checked':''}>${day}</label>`).join('')}</div><div class="section-label">ADDITIONAL DAYS OFF</div><p class="tiny">Add holidays or turnaround days, one date per line (YYYY-MM-DD).</p><textarea id="calendar-days" rows="3" placeholder="2026-12-25">${esc((c?.events || []).filter(e=>e.type==='dayOff').map(e=>e.date.slice(0,10)).join('\n'))}</textarea>`,'<button id="modal-cancel">Cancel</button><button class="primary" id="settings-submit">Save settings</button>');
  $('#settings-submit').onclick=()=>{
    const title=$('[data-field="title"]').value.trim(),startValue=$('[data-field="start-date"]').value,off=$$('[name="days-off"]:checked').map(x=>Number(x.value));
    const extra=$('#calendar-days').value.split(/\s+/).filter(Boolean);
    if(!title||!startValue){$('#modal-error').textContent='Add a title and first shooting date.';return;}
    if(off.length===7){$('#modal-error').textContent='Leave at least one weekday available to shoot.';return;}
    if(extra.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!validDate(d))){$('#modal-error').textContent='Enter valid dates, one per line, such as 2026-12-25.';return;}
    const name=$('[data-field="schedule-name"]').value.trim(),author=$('[data-field="author"]').value,company=$('[data-field="company"]').value;
    mutate(()=>{
      project.project=title;project.name=name||'Shooting schedule';project.author=author||null;project.company=company||null;
      let cal=c;if(!cal){cal={id:id(),name:'Production calendar',daysOff:[],events:[]};project.calendars.push(cal);activeScenario().calendar=cal.id;}
      cal.daysOff=off;cal.events=cal.events.filter(e=>e.type!=='dayOff'&&e.type!=='start');cal.events.unshift({id:id(),date:startValue+'T12:00:00.000Z',type:'start',name:null});
      for(const date of new Set(extra))cal.events.push({id:id(),date:date+'T12:00:00.000Z',type:'dayOff',name:'dayOff'});
    });$('#modal').close();
  };
}
function validDate(date){const d=new Date(date+'T12:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===date;}
function availabilityModal(eid) {
  const e=project.elements.find(e=>e.id===eid);
  modal('Availability · '+esc(e.name),`<p>Days off will be flagged on any shooting day that needs this element.</p><div class="section-label">WEEKLY DAYS OFF</div><div class="weekday-row">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=>`<label><input type="checkbox" name="availability-day" value="${i}" ${(e.daysOff||[]).includes(i)?'checked':''}>${day}</label>`).join('')}</div><label class="field">Specific dates off<textarea id="availability-dates" rows="5" placeholder="YYYY-MM-DD, one per line">${esc((e.events||[]).filter(x=>x.type==='dayOff').map(x=>x.date.slice(0,10)).join('\n'))}</textarea></label>`,'<button id="modal-cancel">Cancel</button><button class="primary" id="availability-submit">Save availability</button>');
  $('#availability-submit').onclick=()=>{
    const days=$$('[name="availability-day"]:checked').map(x=>Number(x.value)),extra=$('#availability-dates').value.split(/\s+/).filter(Boolean);
    if(extra.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!validDate(d))){$('#modal-error').textContent='Enter valid dates as YYYY-MM-DD.';return;}
    mutate(()=>{e.daysOff=days;e.events=(e.events||[]).filter(x=>x.type!=='dayOff');for(const date of new Set(extra))e.events.push({id:id(),date:date+'T12:00:00.000Z',type:'dayOff',name:'dayOff'});});$('#modal').close();
  };
}
async function download(filename,data,type='application/json') {
  try{const result=await api('/api/export',{filename,content:data,mime:type});if(!result.native){const a=document.createElement('a');a.href=result.url;a.download=filename;document.body.append(a);a.click();a.remove();}toast('Export file is ready.');}
  catch(e){toast('Export failed: '+e.message);}
}
function exportModal() {
  modal('Take your work with you',`<p>Exports are files on your computer. Use a full backup to keep script text, every production, shot lists, and all schedule scenarios.</p><div class="export-options"><button id="export-uss"><strong>Universal Schedule Standard (.uss)</strong><span>Breakdowns, elements, scenarios, and calendars. Script text and shot lists are excluded; use a full backup to keep them.</span></button><button id="export-backup"><strong>Full Production Desk backup (.json)</strong><span>All productions, shot lists, original scene text, notes, and schedules. Import to restore.</span></button><button id="export-csv"><strong>One-line schedule (.csv)</strong><span>The current shooting schedule for spreadsheets.</span></button><button id="export-shots"><strong>Shot list (.csv)</strong><span>Shots in the current shot-list view, including camera details and takes.</span></button><button id="export-print"><strong>Print / Save as PDF</strong><span>A clean one-line schedule, using your browser’s print dialog.</span></button></div>`);
  const filename=((project.project||project.name).replace(/[^\w -]/g,'').trim()||'production').slice(0,150);
  $('#export-uss').onclick=()=>{const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!k.startsWith('_')).map(([k,v])=>[k,clean(v)])):value;const output=clean(project);output.source='Production Desk — Local Film Scheduler';download(filename+'.uss',JSON.stringify({universalScheduleStandard:output},null,2));};
  $('#export-backup').onclick=()=>{download('Production-Desk-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(workspace,null,2));};
  $('#export-csv').onclick=()=>{const rows=[['Day','Date','Scene','INT/EXT','Set','Day/Night','Synopsis','Pages','Minutes','Cast','Location']];let day=0;const ds=dates(scheduleGroups().filter(Array.isArray).length);for(const g of scheduleGroups()){if(Array.isArray(g))day++;for(const bid of Array.isArray(g)?g:[g]){const b=breakdown(bid);if(!b)continue;rows.push([day||'',day?ds[day-1]:'',b.scene,prop(b,1),b.type==='banner'?b.bannerText:prop(b,0),prop(b,2),b.description,b.pages,(b.duration||0)/60000,prop(b,100),prop(b,6)]);}}const safe=v=>{const s=String(v??'');return /^[=+@\-\t\r]/.test(s)?"'"+s:s;};download(filename+'-schedule.csv',rows.map(row=>row.map(v=>'"'+safe(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv;charset=utf-8');};
  $('#export-shots').onclick=()=>shotDesk.csv();
  $('#export-print').onclick=()=>{report='oneline';$('#modal').close();action('print');};
}
function helpModal() {modal('Your local production desk',`<ol class="help-steps"><li><strong>Import a PDF or Final Draft script.</strong> Scene headings become editable breakdown sheets. Imports create separate productions.</li><li><strong>Break down each scene.</strong> Select script text to tag cast, props, wardrobe, or other elements. Fill in sets, locations, page eighths, and time estimates.</li><li><strong>Build the shooting board.</strong> Open Shooting schedule. Add days, then drag scenes into them. Drop on a strip to insert above it. Use Move scene for a keyboard-friendly alternative. Click the ◐ button on a strip to choose a preset or custom color; Automatic restores its default time-of-day color.</li><li><strong>Plan around availability.</strong> Set the start date and days off in Production settings. Manage cast availability in Elements.</li><li><strong>Plan and track your shots.</strong> Open Shot list, choose a scene, and add numbered shots with camera setups and time estimates. Drag to reorder; track takes, actual time, and completion. Shots follow their scene’s shooting day.</li><li><strong>Save and share as files.</strong> Every change saves locally. Export USS for interchange and a full Production Desk backup to preserve scripts and shots.</li></ol><p>Undo: ⌘Z / Ctrl+Z · Redo: ⌘⇧Z / Ctrl+Shift+Z · Save: ⌘S / Ctrl+S.<br>Your local server must be running to use the app. No internet connection is needed.</p><section class="help-bug-report" aria-labelledby="bug-report-title"><h3 id="bug-report-title">Report a bug</h3><p>Email <a href="mailto:alexanderhosier@squidproductions.org">alexanderhosier@squidproductions.org</a>.</p><p>Include Production Desk 1.4.1, your macOS version, steps to reproduce the problem, what you expected, and what happened. Screenshots are helpful.</p></section>`);}

const shotDesk=createShotDesk({
  esc,id,stamp,project:()=>project,selectedScene:()=>selected,slug,groups:scheduleGroups,dates,dateLabel,scenarioSelect,scenarioName:()=>activeScenario().name,
  mutate,render,toast,modal,confirm:confirmModal,download,
  edit:(fn,begin)=>{if(begin){history.push(clone(workspace));if(history.length>40)history.shift();future=[];}fn();mark();updateUndo();}
});
const appSettings=createAppSettings({api,modal,esc,toast,current:()=>({project,scenario:activeScenario()}),isIPad:isIPadApp});
const elementActions=createElementActions({project:()=>project,mutate,confirm:confirmModal,toast});
$('#app-settings-open').onclick=()=>appSettings.open();

$('#navigation').addEventListener('click',e=>{const button=e.target.closest('[data-view]');if(button){view=button.dataset.view;render();}});
$('#project-picker').onchange=e=>{mutate(()=>{workspace.activeProject=e.target.value;scenarioIndex=0;selected=undefined;search='';});};
$('#undo').onclick=()=>undo();$('#redo').onclick=()=>undo(true);$('#save-status').onclick=()=>save();
$('#import-open').onclick=importModal;$('#settings-open').onclick=()=>settingsModal();$('#help-open').onclick=helpModal;$('#export-open').onclick=exportModal;$('#add-scene').onclick=()=>view==='shots'?shotDesk.add():newScene();
$('#new-open').onclick=()=>textModal('New production','Production title','Untitled production',async title=>{try{const p=await api('/api/new',{title});mutate(()=>{workspace.projects.push(p);workspace.activeProject=p.id;scenarioIndex=0;selected=undefined;view='workspace';});}catch(e){toast(e.message);}});
document.addEventListener('keydown',e=>{const editing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save();}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!editing&&!$('#modal').open){e.preventDefault();undo(e.shiftKey);}});
window.addEventListener('beforeunload',e=>{if(savedRevision!==revision){e.preventDefault();e.returnValue='Your latest change is still saving.';}});
if(isIPadApp){
  document.body.classList.add('ipad-app');
  setupMobileLayout();
  $('.brand-edition').textContent='LOCAL EDITION';
  $('.offline-pill').innerHTML='<span class="status-dot"></span>Saved on your device';
  $('.sidebar-bottom p').innerHTML='Your stories stay yours.<br>Export files to share.';
  // Keep instructions shared with the desktop while identifying native actions.
  const updateCopy=()=>{
    for(const el of $$('.modal-body p'))el.innerHTML=el.innerHTML.replaceAll('on this computer','on this device').replaceAll('on your computer','on your device').replaceAll('your macOS version','your iOS version').replace('Your local server must be running to use the app.','This app saves directly on your device.');
    const print=$('#export-print span');if(print)print.textContent='Share a PDF or print with AirPrint.';
  };
  new MutationObserver(updateCopy).observe($('#modal-content'),{childList:true});
  window.print=()=>nativePrint().catch(e=>toast('PDF export failed: '+e.message));
  document.addEventListener('selectionchange',()=>{const selection=window.getSelection(),script=$('#script-text');if(script&&selection&&!selection.isCollapsed&&script.contains(selection.anchorNode)&&script.contains(selection.focusNode))selectedText=selection.toString().trim();});
}
try {workspace=await api('/api/workspace');useProject();render();$('#save-status').textContent=savedLabel;await appSettings.init();
  if(window.productionDeskRecovery){const warning=document.createElement('div');warning.className='notice recovery-notice';warning.setAttribute('role','alert');warning.textContent=window.productionDeskRecovery;$('#summary').after(warning);}
  document.body.dataset.ready='true';document.body.dataset.appReady='true';}
catch(e){$('#project-title').textContent='Could not open local workspace';$('#page-subtitle').textContent=e.message;$('#save-status').textContent=isIPadApp?'Local files unavailable':'Local server unavailable';$('#content').innerHTML=isIPadApp?'<div class="panel empty-state">Your saved files have been preserved. In Files → On My iPhone / iPad → Production Desk, keep workspace.json and workspace.previous.json safe. Restore a known-good workspace.json there, then reopen the app.</div>':'<div class="panel empty-state">Start the app with Start Production Desk.command, then reload this page. If the data file is damaged, recover data/workspace.previous.json before changing anything.</div>';}
