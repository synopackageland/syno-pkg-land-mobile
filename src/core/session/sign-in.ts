export type SignInEvent = { viewId: number; origin: string; scope: string };

/** Completion comes from a verified Auth reply and the committed native cookie jar. */
export class SignInSession {
  private done = false;
  private origin: string;
  constructor(origin: string) { this.origin = origin; }
  accept(event: SignInEvent, viewId: number | null, scope: string): boolean {
    if (this.done || event.viewId !== viewId || event.origin !== this.origin || !scope || event.scope !== scope) return false;
    this.done = true;
    return true;
  }
}

/**
 * Keep DSM's form, encryption, challenges and real XHR/fetch response handling.
 * Only Auth.login uses a single-use native route and a fresh HTTP connection.
 * Passwords/ciphertext stay in memory; the route contains only a random handle.
 */
export function signInScript(origin: string): string {
  return `(function(){
    if(window!==window.top || location.origin!==${JSON.stringify(origin)} || !window.SynoPkgSignIn || window.__synoSignInReady)return;
    var bridge=window.SynoPkgSignIn, pending=new Map(), states=new WeakMap(), serial=0;
    var prefix=Math.random().toString(36).slice(2)+':';
    function post(value){bridge.postMessage(JSON.stringify(value));}
    function login(method,url,body){
      if(method!=='POST' || typeof body!=='string')return false;
      try{
        var u=new URL(url,location.href), p=new URLSearchParams(body);
        return u.origin===location.origin && u.pathname.indexOf('/webapi/')===0 &&
          (p.get('api') || u.searchParams.get('api'))==='SYNO.API.Auth' && p.get('method')==='login';
      }catch(e){return false;}
    }
    function cancel(state){
      if(!state || !state.id)return;
      pending.delete(state.id);post({type:'cancel',id:state.id});state.id=null;
    }
    function prepare(state){
      state.id=prefix+(++serial);pending.set(state.id,state);
      post({type:'prepare',id:state.id,url:state.url,body:state.body,headers:state.headers});
      state.body=null;
    }
    window.__synoSignInReady=function(id,route){
      var state=pending.get(id);if(!state)return;pending.delete(id);
      var valid=false;
      try{var u=new URL(route);valid=u.origin===location.origin && u.pathname.indexOf('/.synopkg-sign-in/')===0 && !u.search && !u.hash;}catch(e){}
      if(!valid){state.fail();return;}
      state.start(route);
    };
    var proto=window.XMLHttpRequest.prototype, open=proto.open, send=proto.send, header=proto.setRequestHeader, abort=proto.abort;
    proto.open=function(method,url,async){
      cancel(states.get(this));
      try{delete this.responseURL;}catch(e){}
      states.set(this,{method:String(method).toUpperCase(),url:new URL(url,location.href).href,async:async!==false,headers:{}});
      return open.apply(this,arguments);
    };
    proto.setRequestHeader=function(name,value){
      var state=states.get(this);if(state)state.headers[name]=state.headers[name]?state.headers[name]+', '+value:String(value);
      return header.apply(this,arguments);
    };
    proto.abort=function(){cancel(states.get(this));return abort.apply(this,arguments);};
    proto.send=function(body){
      var xhr=this,state=states.get(xhr), text=typeof body==='string'?body:body instanceof URLSearchParams?body.toString():null;
      if(!state || !state.async || !login(state.method,state.url,text))return send.apply(xhr,arguments);
      if(state.sending)throw new DOMException('Request already sent','InvalidStateError');
      state.sending=true;
      state.body=text;
      state.fail=function(){
        state.id=null;
        xhr.dispatchEvent(new Event('error'));xhr.dispatchEvent(new Event('loadend'));
      };
      state.start=function(route){
        if(states.get(xhr)!==state)return;
        var responseType=xhr.responseType,credentials=xhr.withCredentials,timeout=xhr.timeout;
        open.call(xhr,'GET',route,true);
        xhr.responseType=responseType;xhr.withCredentials=credentials;xhr.timeout=timeout;
        Object.keys(state.headers).forEach(function(name){header.call(xhr,name,state.headers[name]);});
        try{Object.defineProperty(xhr,'responseURL',{configurable:true,get:function(){return state.url;}});}catch(e){}
        xhr.addEventListener('loadend',function(){state.id=null;},{once:true});
        send.call(xhr);
      };
      prepare(state);
    };
    if(typeof window.fetch==='function' && typeof window.Request==='function'){
      var fetch=window.fetch.bind(window);
      window.fetch=function(input,init){
        var request;
        try{request=new window.Request(input,init);}catch(e){return fetch(input,init);}
        var url=new URL(request.url), contentType=request.headers.get('content-type') || '';
        if(request.method!=='POST' || url.origin!==location.origin || url.pathname.indexOf('/webapi/')!==0 ||
          contentType.toLowerCase().indexOf('application/x-www-form-urlencoded')!==0)return fetch(request);
        return request.clone().text().then(function(body){
          if(!login(request.method,request.url,body))return fetch(request);
          return new Promise(function(resolve,reject){
            var state={url:request.url,body:body,headers:{}};
            request.headers.forEach(function(value,name){state.headers[name]=value;});
            function stopped(){cancel(state);reject(new DOMException('Aborted','AbortError'));}
            if(request.signal.aborted){stopped();return;}
            request.signal.addEventListener('abort',stopped,{once:true});
            state.fail=function(){request.signal.removeEventListener('abort',stopped);reject(new TypeError('Sign-in request failed'));};
            state.start=function(route){
              fetch(route,{method:'GET',credentials:'same-origin',cache:'no-store',signal:request.signal}).then(function(response){
                try{Object.defineProperty(response,'url',{configurable:true,value:request.url});}catch(e){}
                resolve(response);
              },reject).finally(function(){state.id=null;request.signal.removeEventListener('abort',stopped);});
            };
            prepare(state);
          });
        });
      };
    }
  })();true;`;
}
