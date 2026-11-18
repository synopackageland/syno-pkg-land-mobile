/** Read DSM's live decisions, including overrides made by autoLaunch extensions. */
export function runtimeProbe(origin: string, scope: string): string {
  return `(function(){
    if(window!==window.top || location.origin!==${JSON.stringify(origin)})return;
    if(window.__synoRuntimeProbe)clearInterval(window.__synoRuntimeProbe);
    var previous='';
    function check(){
      try{
        var s=window.SYNO && window.SYNO.SDS;
        if(!s || !s.Config || !s.Config.FnMap || !s.AppUtil || !s.StatusNotifier ||
          typeof s.AppUtil.isValidApp!=='function' || typeof s.StatusNotifier.isAppHasPrivilege!=='function')return;
        var values={};
        Object.keys(s.Config.FnMap).forEach(function(id){
          try{
            var privilege=s.StatusNotifier.isAppHasPrivilege(id), valid=s.AppUtil.isValidApp(id);
            if(typeof privilege==='boolean' && typeof valid==='boolean')values[id]=privilege && valid;
          }catch(e){}
        });
        var encoded=JSON.stringify(values);
        if(encoded!==previous){
          window.ReactNativeWebView.postMessage(JSON.stringify({internal:'runtimeVisibility',scope:${JSON.stringify(scope)},origin:location.origin,values:values}));
          previous=encoded;
        }
      }catch(e){}
    }
    check();window.__synoRuntimeProbe=setInterval(check,500);
  })();true;`;
}

export function runtimeValues(value: unknown): Record<string, boolean> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 10000 || entries.some(([, allowed]) => typeof allowed !== 'boolean')) return null;
  return Object.fromEntries(entries);
}
