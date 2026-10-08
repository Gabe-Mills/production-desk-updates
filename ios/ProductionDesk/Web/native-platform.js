import {emptyProject, importScript, importBackup, validateWorkspace} from './film-native.js';
export async function nativeAPI(path, data, headers={}) {
  const send = value => window.webkit.messageHandlers.scheduler.postMessage(value);
  switch(path){
    case '/api/workspace':
      if(data!==undefined){validateWorkspace(data);return send({operation:'save',workspace:data});}
      {
        const loaded=await send({operation:'load'});
        if(loaded!==null)return validateWorkspace(loaded);
        const project=emptyProject();
        const workspace={version:1,activeProject:project.id,projects:[project]};
        await send({operation:'save',workspace});
        return workspace;
      }
    case '/api/new':return emptyProject(data.title||'Untitled production');
    case '/api/import':{
      const filename=decodeURIComponent(headers['X-Filename']||'script.txt').split(/[\\/]/).pop();
      if((data instanceof Blob && data.size>40*1024*1024)||(typeof data==='string' && new TextEncoder().encode(data).length>40*1024*1024))throw Error('Choose a file smaller than 40 MB.');
      let text;
      if(filename.toLowerCase().endsWith('.pdf')){
        const bytes=new Uint8Array(await data.arrayBuffer());let binary='';
        for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        text=await send({operation:'pdf',base64:btoa(binary)});
      }else text=typeof data==='string'?data:await data.text();
      text=text.replace(/^\uFEFF/,'');
      return /\.(uss|json)$/i.test(filename)?importBackup(text):{project:importScript(text,filename)};
    }
    case '/api/export':await send({operation:'export',...data});return {native:true};
    default:throw Error('Unknown local operation.');
  }
}
export async function nativePrint(){return window.webkit.messageHandlers.scheduler.postMessage({operation:'print'});}
