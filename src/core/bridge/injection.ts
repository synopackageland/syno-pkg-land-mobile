import type { NativeBridge, NativeEvent } from './contract.ts';
/** Android executes this at document start only on the configured origin */
export function bridgeScript(origin: string, description: Omit<NativeBridge, 'post'>): string {
  return `(function(){
    if (window !== window.top || location.origin !== ${JSON.stringify(origin)} || !window.SynoPkgTransport) return;
    var send = function(m){window.SynoPkgTransport.postMessage(JSON.stringify(m));};
    var activated = false;
    document.addEventListener('click', function(e){if(e.isTrusted) activated=true;}, true);
    var bridge = ${JSON.stringify(description)};
    bridge.post = function(m){
      if(m && m.type === 'openExternal'){
        if(!(navigator.userActivation && navigator.userActivation.isActive) && !activated) return;
        activated=false;
      }
      send({message:m});
    };
    Object.defineProperty(window,'SynoPkgNative',{value:Object.freeze(bridge),configurable:false});
    var pendingInput=null, pendingMedia={}; var serial=0;
    window.__synoCameraDone=function(id,granted){
      if(id==='input'){var input=pendingInput;pendingInput=null;if(granted && input && input.isConnected){input.dataset.synoCamera='yes';input.click();}return;}
      var p=pendingMedia[id];delete pendingMedia[id];if(p){if(granted)p.resolve();else p.reject(new DOMException('Camera denied','NotAllowedError'));}
    };
    document.addEventListener('click',function(e){
      var a=e.target && e.target.closest && e.target.closest('a');
      if(a && e.isTrusted && (a.target==='_blank' || (a.href && new URL(a.href,location.href).origin!==location.origin))){
        if(/^https?:/.test(a.href)){e.preventDefault();bridge.post({v:1,type:'openExternal',url:a.href});}return;
      }
      if(a && e.isTrusted && a.hasAttribute('download') && bridge.caps.download && bridge.caps.download.base64){
        e.preventDefault();var href=a.href, name=a.download||'download';
        if(/^blob:/.test(href))fetch(href).then(function(r){return r.blob();}).then(function(b){
          if(b.size>bridge.caps.download.maxBase64)throw Error('File too large');var reader=new FileReader();reader.onload=function(){bridge.post({v:1,type:'download',id:'anchor_'+(++serial),filename:name,mime:b.type||'application/octet-stream',base64:String(reader.result).split(',')[1]});};reader.readAsDataURL(b);
        }).catch(function(){});
        else bridge.post({v:1,type:'download',id:'anchor_'+(++serial),filename:name,mime:'application/octet-stream',url:href});
      }
      var t=e.target;
      if(!bridge.caps.camera || !e.isTrusted || !t || t.tagName!=='INPUT' || t.type!=='file' || !/image|video/.test(t.accept||'') || t.dataset.synoCamera==='yes')return;
      e.preventDefault();e.stopImmediatePropagation();pendingInput=t;send({internal:'camera',id:'input'});
    },true);
    if(bridge.caps.camera && navigator.mediaDevices && navigator.mediaDevices.getUserMedia){
      var gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=function(c){if(c && c.audio)return Promise.reject(new DOMException('Audio unavailable','NotAllowedError'));var id='media'+(++serial);return new Promise(function(resolve,reject){pendingMedia[id]={resolve:resolve,reject:reject};send({internal:'camera',id:id});}).then(function(){return gum(c);});};
    }
    try{new PerformanceObserver(function(list){list.getEntries().forEach(function(e){if(e.name==='first-contentful-paint')bridge.post({v:1,type:'ready',fcp:e.startTime});});}).observe({type:'paint',buffered:true});}catch(e){}
  })();true;`;
}
export function eventScript(origin: string, event: NativeEvent): string {
  return `if(window===window.top && location.origin===${JSON.stringify(origin)})window.dispatchEvent(new CustomEvent('synopkgnative',{detail:${JSON.stringify(event)}}));true;`;
}
