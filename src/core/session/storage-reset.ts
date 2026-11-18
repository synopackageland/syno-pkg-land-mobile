/**
 * DSM's page keeps what `SYNO.API.Auth resume` needs in localStorage: `crossPortData`
 * ({currentLoginUser, _HSID}, read by SYNO.SDS.HandShake.Init) and `lastHS`. Cookies and
 * IndexedDB are cleared natively, but this survives, so the first DSM page after a sign-out
 * or a native sign-in would resume the previous web account. Native code writes a new nonce
 * for the origin at those moments; this document-start script removes the keys once per
 * nonce and records the nonce, so what DSM writes for the new account afterwards stays.
 */
export const RESET_MARKER = 'SynoPkgLand.storageReset';
export const RESUME_KEYS = ['crossPortData', 'lastHS'];

export function storageResetScript(origin: string, nonce: string): string {
  if (!nonce) return '';
  return `(function(){try{
    if (location.origin !== ${JSON.stringify(origin)}) return;
    var s = window.localStorage, nonce = ${JSON.stringify(nonce)};
    if (!s || s.getItem(${JSON.stringify(RESET_MARKER)}) === nonce) return;
    ${JSON.stringify(RESUME_KEYS)}.forEach(function(k){ s.removeItem(k); });
    s.setItem(${JSON.stringify(RESET_MARKER)}, nonce);
  }catch(e){}})();true;`;
}
