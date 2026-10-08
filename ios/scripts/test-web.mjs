// Dependency-free data/bridge regression suite. Browser DOMParser/FDX and UIKit
// presentation are deliberately exercised by the simulator suite, not emulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, parseHeading, parseScript, importScript, importBackup, validateUSS, validateWorkspace } from '../ProductionDesk/Web/film-native.js';
import { nativeAPI, nativePrint } from '../ProductionDesk/Web/native-platform.js';
import { createShotDesk, formatShotDuration } from '../ProductionDesk/Web/shots.js';
import { validStripColor, stripTextColor } from '../ProductionDesk/Web/strip-colors.js';

const script = 'Title: Test Production\n\nINT. KITCHEN - DAY #12A#\n\nMAYA (V.O.)\nThe kettle whistles.\n\nEXT. STREET - NIGHT #13#\n\nMAYA\nWe are late.\n\nJON\nTake the car.';
const project = () => importScript(script, 'Test_Production.fountain');
const workspace = p => ({version:1,activeProject:p.id,projects:[p]});
const backup = p => JSON.stringify(workspace(p));
const shot = (p, overrides={}) => ({id:crypto.randomUUID(),created:p.created,sceneId:p.breakdowns[0].id,number:'A',description:'Wide master',size:'Wide',movement:'Static',camera:'A',lens:'35',equipment:'Tripod',setupMinutes:10,shootMinutes:15,actualMinutes:null,takes:0,circleTake:'',priority:'Essential',notes:'',status:'Planned',...overrides});
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function bridge(handler) {
  const calls=[];
  globalThis.window={webkit:{messageHandlers:{scheduler:{postMessage:async message=>{calls.push(message);return handler?.(message);}}}}};
  return calls;
}
function desk(p) {
  p._shots ??= []; p._shotSettings ??= {startTime:'07:00'};
  let current=p, downloaded, printed=0;
  const nodes=new Map();
  for(const selector of ['#shot-day','#shot-scene','#shot-status','#shot-search','#shot-start','#shot-metrics','#shot-list','#shot-count','#shot-detail-label','#print-area'])nodes.set(selector,{});
  globalThis.document={querySelector:selector=>nodes.get(selector)??null,querySelectorAll:()=>[]};
  globalThis.window={print:()=>printed++};
  const controller=createShotDesk({esc,id:()=>crypto.randomUUID(),stamp:()=>new Date().toISOString(),project:()=>current,selectedScene:()=>current.breakdowns[0]?.id,slug:b=>b?.scene ? `Scene ${b.scene}` : '',groups:()=>current.stripboards[0].boards[0].breakdownIds,dates:count=>Array.from({length:count},(_,i)=>`2026-10-${12+i}`),dateLabel:d=>d,scenarioSelect:()=>'',scenarioName:()=>current.stripboards[0].name,download:(filename,content,mime)=>downloaded={filename,content,mime},mutate:fn=>fn(),edit:fn=>fn(),render:()=>controller.render()});
  return {controller,nodes,setProject:value=>current=value,downloaded:()=>downloaded,printed:()=>printed};
}

test('new productions have independent IDs, original brand provenance and valid USS structure', () => {
  const a=emptyProject('The Story'),b=emptyProject('The Story');
  assert.equal(validateUSS(a),a);
  assert.notEqual(a.id,b.id);
  assert.equal(a.source,'Production Desk — Local Film Scheduler');
  assert.equal(a.ussVersion,'1.0.0');
  assert.deepEqual(a.calendars[0].daysOff,[0,6]);
  assert.deepEqual(a.stripboards[0].boards.map(b=>b.breakdownIds),[[],[]]);
});
test('scene headings preserve explicit Fountain numbers, mixed interiors and set numbers', () => {
  assert.deepEqual(parseHeading('INT. KITCHEN - DAY #12A#'),['12A','INT','KITCHEN','Day']);
  assert.deepEqual(parseHeading('23 EXT./INT. CAR – NIGHT 23'),['23','I/E','CAR','Night']);
  assert.deepEqual(parseHeading('EXT. STAGE 5'),[undefined,'EXT','STAGE 5','Day']);
  assert.equal(parseHeading('The kettle whistles.'),null);
});
test('script import preserves source text, scene numbering and character deduplication', () => {
  const p=project();validateUSS(p);
  assert.equal(p.project,'Test Production');
  assert.equal(p._scriptFilename,'Test_Production.fountain');
  assert.deepEqual(p.breakdowns.map(b=>b.scene),['12A','13']);
  assert.match(p.breakdowns[0]._scriptText,/MAYA \(V\.O\.\)/);
  const cast=p.elements.filter(e=>e.category===p.categories.find(c=>c.ucid===100).id);
  assert.deepEqual(cast.map(e=>e.name),['MAYA','JON']);
  assert.equal(p.breakdowns[0].elements.filter(id=>id===cast[0].id).length,1);
  assert.deepEqual(p.stripboards[0].boards[1].breakdownIds,p.breakdowns.map(b=>b.id));
  assert.ok(p.breakdowns.every(b=>b._needsReview&&b.pages>=0.125&&Number.isInteger(b.pages*8)));
});
test('plain text parsing skips page furniture and records form-feed script pages', () => {
  const scenes=parseScript('INT. ROOM - DAY\n1.\nCONTINUED:\nMAYA\nHi\n\fEXT. ROAD - NIGHT\nJON\nBye');
  assert.deepEqual(scenes.map(s=>s.startPage),['1','2']);
  assert.deepEqual(scenes[0].cast,['MAYA']);
  assert.ok(!scenes[0].lines.includes('CONTINUED:'));
});
test('script import explains missing headings and rejects XML entity declarations before DOM parsing', () => {
  assert.throws(()=>importScript('No scene heading','notes.txt'),/No scene headings/);
  assert.throws(()=>parseScript('<!DOCTYPE script [<!ENTITY x SYSTEM "file:///private/data">]>',true),/XML entities/);
});
test('full workspace round trips scene text, shots, strip colors, schedules and custom provenance', () => {
  const p=project();p.source='Original studio';p._shots=[shot(p)];p._shotSettings={startTime:'23:45'};
  p.breakdowns[0]._stripColor='#7953AD';p.breakdowns[0].comments='Keep the original note';
  p.stripboards[0].boards[0].breakdownIds=[[p.breakdowns[0].id]];
  p.stripboards[0].boards[1].breakdownIds=[p.breakdowns[1].id];
  const alternate=structuredClone(p.stripboards[0]);alternate.id=crypto.randomUUID();alternate.name='Alternate';alternate.boards.forEach(b=>b.id=crypto.randomUUID());p.stripboards.push(alternate);
  const result=importBackup(backup(p));
  assert.deepEqual(result.workspace,workspace(p));
  assert.equal(result.workspace.projects[0].source,'Original studio');
});
test('minimal USS interchange gains a local schedule while preserving original IDs and source', () => {
  const p=project();delete p.stripboards;delete p.calendars;p.source='Upstream USS exporter';
  const result=importBackup(JSON.stringify({universalScheduleStandard:p})).project;
  assert.equal(result.id,p.id);assert.equal(result.source,'Upstream USS exporter');
  assert.deepEqual(result.stripboards[0].boards[1].breakdownIds,p.breakdowns.map(b=>b.id));
  validateUSS(result);
});
test('workspace rejects empty, duplicate and incorrectly active project collections', () => {
  const p=project();
  assert.throws(()=>validateWorkspace({projects:[]}),/Invalid workspace/);
  assert.throws(()=>validateWorkspace({version:1,projects:[p,p],activeProject:p.id}),/duplicate project IDs/);
  assert.throws(()=>validateWorkspace({version:1,projects:[p],activeProject:'missing'}),/active project/);
});
test('USS rejects unsupported versions, duplicate IDs and broken cross references', () => {
  const cases=[
    [p=>p.ussVersion='9.0',/supports USS/],
    [p=>p.categories[0].id=p.id,/Duplicate USS id/],
    [p=>p.elements[0].category='missing',/invalid category/],
    [p=>p.breakdowns[0].elements.push('missing'),/unknown element/],
    [p=>p.stripboards[0].calendar='missing',/unknown calendar/],
    [p=>p.stripboards[0].boards[1].breakdownIds.push('missing'),/unknown breakdown/],
    [p=>p.stripboards[0].boards[1].breakdownIds.push(p.breakdowns[0].id),/every breakdown exactly once/],
    [p=>p.stripboards[0].boards[1].breakdownIds.pop(),/every breakdown exactly once/],
    [p=>p.breakdowns[0].pages=-1,/nonnegative/],
    [p=>p.breakdowns[0].duration=Infinity,/nonnegative/],
    [p=>p.breakdowns[0]._stripColor='red;position:fixed',/six-digit hex/]
  ];
  for(const [mutate,error] of cases){const p=project();mutate(p);assert.throws(()=>validateUSS(p),error);}
});
test('calendar validation rejects impossible dates, duplicates and invalid weekday values', () => {
  const cases=[
    [p=>p.calendars[0].events[0].date='2026-02-30',/Invalid event date/],
    [p=>p.calendars[0].events[0].type='unknown',/Unknown calendar event/],
    [p=>p.calendars[0].daysOff=[6,6],/distinct weekdays/],
    [p=>p.calendars[0].daysOff=[7],/distinct weekdays/],
    [p=>p.calendars[0].events.push({...p.calendars[0].events[0]}),/Duplicate USS id/]
  ];
  for(const [mutate,error] of cases){const p=project();mutate(p);assert.throws(()=>validateUSS(p),error);}
});
test('USS preserves compatibility with optional calendar fields and a single shooting board', () => {
  const p=project();delete p.calendars[0].events;delete p.calendars[0].daysOff;
  p.stripboards[0].boards=[{...p.stripboards[0].boards[0],breakdownIds:[p.breakdowns.map(b=>b.id)]}];
  const imported=importBackup(JSON.stringify({universalScheduleStandard:p})).project;
  assert.equal(imported.calendars[0].events,undefined);
  assert.deepEqual(imported.stripboards[0].boards[0].breakdownIds,[p.breakdowns.map(b=>b.id)]);
  assert.equal(validateUSS(imported),imported);
  // app.normalize supplies optional calendar arrays and a holding board before
  // rendering. That DOM path is covered by RuntimeWorkflowTests in WebKit.
});
test('malformed linked-element collections are rejected before partial element deletion', () => {
  for(const malformed of [{},'not-an-array',[1],[null]]) {
    const p=project();p.elements[0].linkedElements=malformed;
    assert.throws(()=>importBackup(backup(p)),/linkedElements|linked elements/i);
  }
  const p=project();p.elements[0].linkedElements=[p.elements[1].id];
  assert.deepEqual(importBackup(backup(p)).workspace.projects[0].elements[0].linkedElements,[p.elements[1].id]);
});
test('shot validation prevents orphan references, duplicate numbers, invalid states and out-of-range timing', () => {
  const cases=[
    [p=>p._shots[0].sceneId='missing',/unknown scene/],
    [p=>p._shots.push(shot(p,{number:' a '})),/Duplicate shot number/],
    [p=>p._shots[0].number='',/Shot number/],
    [p=>p._shots[0].status='Unknown',/Unknown shot status/],
    [p=>p._shots[0].priority='Critical',/Unknown shot priority/],
    [p=>p._shots[0].setupMinutes=1.5,/whole number/],
    [p=>p._shots[0].shootMinutes=1441,/whole number/],
    [p=>p._shots[0].actualMinutes=10081,/whole number/],
    [p=>p._shots[0].takes=10001,/whole number/],
    [p=>p._shotSettings={startTime:'24:00'},/HH:MM/]
  ];
  for(const [mutate,error] of cases){const p=project();p._shots=[shot(p)];mutate(p);assert.throws(()=>validateUSS(p),error);}
  const p=project();p._shots=[shot(p,{actualMinutes:null,takes:10000})];validateUSS(p);
});
test('malformed local scene text cannot crash script navigation after backup import', () => {
  const p=project();p.breakdowns[0]._scriptText={unsafe:'text'};
  assert.throws(()=>importBackup(backup(p)),/script|text/i);
});
test('workspace imports without a scenario are repaired or rejected before UI use', () => {
  const p=project();p.stripboards=[];p.calendars=[];
  try {const imported=importBackup(backup(p)).workspace.projects[0];assert.ok(imported.stripboards.length>0,'Workspace needs a usable scenario');}
  catch(error){if(error instanceof assert.AssertionError)throw error;assert.match(error.message,/schedule|scenario|stripboard|calendar/i);}
});
test('native new/load/save use only local messages and validate both directions', async () => {
  const p=project(),value=workspace(p),calls=bridge(message=>message.operation==='load'?structuredClone(value):true);
  assert.deepEqual(await nativeAPI('/api/workspace'),value);
  assert.equal(await nativeAPI('/api/workspace',value),true);
  assert.deepEqual(calls.map(c=>c.operation),['load','save']);
  assert.equal((await nativeAPI('/api/new',{title:'Local production'})).project,'Local production');
  await assert.rejects(()=>nativeAPI('/api/workspace',{projects:[]}),/Invalid workspace/);
  assert.equal(calls.length,2,'Invalid workspace must never be sent to disk');
  bridge(()=>({projects:[]}));await assert.rejects(()=>nativeAPI('/api/workspace'),/Invalid workspace/);
});
test('native first launch seeds and saves a valid workspace only after a confirmed empty load', async () => {
  const calls=bridge(message=>message.operation==='load'?null:true);
  const value=await nativeAPI('/api/workspace');validateWorkspace(value);
  assert.deepEqual(calls.map(c=>c.operation),['load','save']);
  assert.deepEqual(calls[1].workspace,value);
  assert.equal(value.projects[0].source,'Production Desk — Local Film Scheduler');
});
test('native corrupt or failed loads are never overwritten with a blank project', async () => {
  let calls=bridge(()=>({version:1,projects:[]}));
  await assert.rejects(()=>nativeAPI('/api/workspace'),/Invalid workspace/);
  assert.deepEqual(calls.map(c=>c.operation),['load']);
  calls=bridge(()=>{throw Error('Workspace file unreadable');});
  await assert.rejects(()=>nativeAPI('/api/workspace'),/Workspace file unreadable/);
  assert.deepEqual(calls.map(c=>c.operation),['load']);
  bridge(message=>{if(message.operation==='load')return null;throw Error('Disk full');});
  await assert.rejects(()=>nativeAPI('/api/workspace'),/Disk full/);
});
test('native script file import strips BOM, accepts encoded names and preserves Unicode', async () => {
  const calls=bridge();
  const result=await nativeAPI('/api/import',new File(['\uFEFFINT. CAFÉ - DAY\nMAYA\nBonjour.'],'Film.fountain'),{'X-Filename':encodeURIComponent('folder/Café_Story.fountain')});
  assert.equal(result.project.project,'Café Story');
  assert.equal(result.project._scriptFilename,'Café_Story.fountain');
  assert.match(result.project.breakdowns[0]._scriptText,/CAFÉ/);
  assert.equal(calls.length,0,'Text parsing stays inside the local webview');
});
test('native backup import preserves workspace and rejects malformed or unrelated JSON', async () => {
  bridge();const p=project();
  assert.deepEqual((await nativeAPI('/api/import',backup(p),{'X-Filename':'backup.json'})).workspace,workspace(p));
  await assert.rejects(()=>nativeAPI('/api/import','{invalid',{'X-Filename':'backup.json'}),SyntaxError);
  await assert.rejects(()=>nativeAPI('/api/import','{"hello":"world"}',{'X-Filename':'backup.json'}),/USS file|workspace backup/);
});
test('native import rejects oversize files before reading or invoking PDFKit', async () => {
  const calls=bridge(),file=new File(['%PDF'],'large.pdf');
  Object.defineProperty(file,'size',{value:40*1024*1024+1});
  file.arrayBuffer=()=>assert.fail('Oversized bytes must never be read');
  await assert.rejects(()=>nativeAPI('/api/import',file,{'X-Filename':'large.pdf'}),/smaller than 40 MB/);
  assert.equal(calls.length,0);
});
test('native pasted text limits are measured as UTF-8 bytes, including non-ASCII scripts', async () => {
  const calls=bridge(),text='é'.repeat(20*1024*1024+1);
  await assert.rejects(()=>nativeAPI('/api/import',text,{'X-Filename':'Pasted.txt'}),/smaller than 40 MB/);
  const blob=new Blob(['Script']);Object.defineProperty(blob,'size',{value:40*1024*1024+1});
  blob.text=()=>assert.fail('Oversized blob must never be read');
  await assert.rejects(()=>nativeAPI('/api/import',blob,{'X-Filename':'Script.txt'}),/smaller than 40 MB/);
  assert.equal(calls.length,0);
});
test('native PDF conversion preserves binary chunks and uses extracted text for parsing', async () => {
  const bytes=Uint8Array.from({length:20003},(_,i)=>i%256),calls=bridge(()=>script);
  const result=await nativeAPI('/api/import',new File([bytes],'Script.pdf'),{'X-Filename':'Script.pdf'});
  assert.equal(calls.length,1);assert.equal(calls[0].operation,'pdf');
  assert.deepEqual(new Uint8Array(Buffer.from(calls[0].base64,'base64')),bytes);
  assert.deepEqual(result.project.breakdowns.map(b=>b.scene),['12A','13']);
});
test('native PDF conversion reports unreadable/scanned PDFs and native failures', async () => {
  const file=new File(['%PDF'],'Script.pdf');bridge(()=> '');
  await assert.rejects(()=>nativeAPI('/api/import',file,{'X-Filename':'Script.pdf'}),/No scene headings/);
  bridge(()=>{throw Error('PDF text extraction failed');});
  await assert.rejects(()=>nativeAPI('/api/import',file,{'X-Filename':'Script.pdf'}),/PDF text extraction failed/);
});
test('native export and print await completion and propagate cancellation/errors', async () => {
  const data={filename:'backup.json',content:backup(project()),mime:'application/json'},calls=bridge(()=>true);
  assert.deepEqual(await nativeAPI('/api/export',data),{native:true});
  assert.deepEqual(calls[0],{operation:'export',...data});
  await nativePrint();assert.equal(calls[1].operation,'print');
  bridge(()=>{throw Error('Share cancelled');});
  await assert.rejects(()=>nativeAPI('/api/export',data),/Share cancelled/);
  await assert.rejects(()=>nativePrint(),/Share cancelled/);
  await assert.rejects(()=>nativeAPI('/api/missing'),/Unknown local operation/);
});
test('shot view excludes omitted shots from totals and reports actual variance only for completed shots', () => {
  const p=project();p._shots=[shot(p,{status:'Done',actualMinutes:30}),shot(p,{number:'B',status:'Omitted',setupMinutes:100,shootMinutes:100}),shot(p,{number:'C',setupMinutes:5,shootMinutes:5})];
  const {controller}=desk(p),html=controller.render();
  assert.match(html,/<strong>2<\/strong><span>planned shots/);
  assert.match(html,/<strong class="shot-duration">35m<\/strong><span>estimated total/);
  assert.match(html,/<strong class="shot-duration">10m<\/strong><span>remaining estimate/);
  assert.match(html,/<strong>\+5<small> min/);
});
test('shots follow scheduled scenes, retain full-day timings under filters and handle overnight time', () => {
  const p=project();p._shots=[shot(p,{description:'First',setupMinutes:10,shootMinutes:20}),shot(p,{number:'B',description:'Second',setupMinutes:5,shootMinutes:10}),shot(p,{number:'A',sceneId:p.breakdowns[1].id,description:'Unscheduled'})];p._shotSettings={startTime:'23:50'};
  p.stripboards[0].boards[0].breakdownIds=[[p.breakdowns[0].id]];p.stripboards[0].boards[1].breakdownIds=[p.breakdowns[1].id];
  const {controller,nodes}=desk(p);controller.render();controller.bind();
  nodes.get('#shot-day').onchange({target:{value:'0'}});
  assert.match(controller.render(),/00:20 \+1d/);
  nodes.get('#shot-search').oninput({target:{value:'Second'}});
  const html=controller.render();assert.match(html,/00:20 \+1d/);assert.doesNotMatch(html,/class="shot-description">First/);
  controller.csv(); // Repeated rendering/export must not clear filters.
  nodes.get('#shot-day').onchange({target:{value:'unscheduled'}});
  nodes.get('#shot-search').oninput({target:{value:''}});
  assert.match(controller.render(),/class="shot-description">Unscheduled/);
});
test('switching productions resets stale shot filters and selection after repeated navigation', () => {
  const p=project();p._shots=[shot(p)];const harness=desk(p);harness.controller.render();harness.controller.bind();
  harness.nodes.get('#shot-search').oninput({target:{value:'No match'}});
  assert.match(harness.controller.render(),/No shots match this view/);
  const other=project();other._shots=[shot(other,{description:'New production shot'})];other._shotSettings={startTime:'07:00'};harness.setProject(other);
  for(let i=0;i<3;i++){assert.match(harness.controller.render(),/New production shot/);harness.controller.bind();}
});
test('shot HTML and CSV exports escape untrusted text, quotes and spreadsheet formulas', () => {
  const p=project();p._shots=[shot(p,{description:'<img src=x onerror=alert(1)>',notes:'=HYPERLINK("https://example.invalid")',camera:'"A"'})];
  const harness=desk(p),html=harness.controller.render();
  assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img src=x/);
  harness.controller.csv();const exported=harness.downloaded();
  assert.equal(exported.filename,'shot-list.csv');assert.equal(exported.mime,'text/csv;charset=utf-8');
  assert.match(exported.content,/"'=HYPERLINK\(""https:\/\/example.invalid""\)"/);
  assert.match(exported.content,/"""A"""/);
  harness.controller.print();assert.equal(harness.printed(),1);assert.doesNotMatch(harness.nodes.get('#print-area').innerHTML,/<img src=x/);
});
test('strip colors accept only safe hex values with readable foregrounds', () => {
  assert.equal(validStripColor('#E60026'),true);assert.equal(validStripColor('url(https://example.invalid)'),false);
  assert.equal(stripTextColor('#000000'),'#FFFFFF');assert.equal(stripTextColor('#FFFFFF'),'#000000');
  assert.equal(formatShotDuration(1501),'1d 1h 1m');
});
