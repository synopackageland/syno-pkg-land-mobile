export class EntryRecovery {
  attempt = 0;
  phase: 'loading' | 'ready' | 'failed' = 'loading';
  restart(): void { this.attempt++; this.phase = 'loading'; }
  loaded(): void { /* A successful navigation can still have an empty DOM */ }
  failed(): void { this.phase = 'failed'; }
  content(attempt: number, visible: boolean): void {
    if (attempt === this.attempt && visible && this.phase === 'loading') this.phase = 'ready';
  }
}
/** Observe eventual content without setting a network or readiness deadline */
export function contentProbe(origin: string, attempt: number): string {
  return `(function(){
    if(window!==window.top || location.origin!==${JSON.stringify(origin)})return;
    if(window.__synoContentProbe)clearInterval(window.__synoContentProbe);
    function check(){
      if(!window.ReactNativeWebView || typeof window.ReactNativeWebView.postMessage!=='function')return false;
      var b=document.body;
      var visual=b && Array.from(b.querySelectorAll('canvas,video,img,svg,input,iframe')).some(function(e){
        var rect=e.getBoundingClientRect(), style=getComputedStyle(e);
        return rect.width>0 && rect.height>0 && style.visibility!=='hidden' && style.opacity!=='0';
      });
      if(b && (b.innerText.trim() || visual)){
        window.ReactNativeWebView.postMessage(JSON.stringify({internal:'content',attempt:${attempt},origin:location.origin}));
        clearInterval(window.__synoContentProbe);return true;
      }
      return false;
    }
    if(!check())window.__synoContentProbe=setInterval(check,500);
  })();true;`;
}
