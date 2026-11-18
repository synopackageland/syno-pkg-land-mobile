/**
 * The App's own DSM sign-in. Password sign-in with `otp_code` as a second step; every
 * successful sign-in registers this phone as a trusted device. DSM sets the `id` and `did`
 * cookies in the WebView jar, so WebView Apps open signed in and a trusted phone skips the
 * code next time. Other sign-in methods hand over to the DSM web sign-in page.
 */
export type SignInFields = {
  account: string; password: string; code?: string; keepSignedIn: boolean;
  /** Phone model and App name, shown in DSM's trusted-device list */
  deviceName: string;
  /** Stable per install; DSM stores exactly 32 characters */
  mobileId: string;
};
/** Why the DSM web page is needed */
export type FallbackReason = 'passkey' | 'approve' | 'otpSetup' | 'passwordChange' | 'sso' | 'other';
export type SignInError = 'wrongPassword' | 'wrongCode' | 'accountDisabled' | 'blocked' | 'noPermission' | 'unavailable' | 'unreachable' | 'certificate' | 'failed';
export type SignInOutcome =
  | { kind: 'done'; scope: string }
  | { kind: 'code' }
  | { kind: 'fallback'; reason: FallbackReason }
  | { kind: 'error'; error: SignInError; code?: number };
export type NativeReply = { success: true; scope: string } | { success: false; status: number; code: number; types: string[] };

/**
 * DSM 7 rejects unknown `session` names with 402, and the admin's trusted-device switch
 * applies to `webui`, which DSM's own page uses. WebView Apps share this session.
 */
export const SESSION = 'webui';

export function loginBody(fields: SignInFields): string {
  const params: Record<string, string> = {
    api: 'SYNO.API.Auth', version: '6', method: 'login', session: SESSION, format: 'cookie',
    account: fields.account, passwd: fields.password,
    enable_device_token: 'yes', device_name: fields.deviceName, mobile_id: fields.mobileId, client: 'mobile',
    rememberme: fields.keepSignedIn ? '1' : '0', enable_syno_token: 'yes',
  };
  // The second step repeats the password with the code; DSM's 2FA token would expire after 300 s
  if (fields.code) params.otp_code = fields.code;
  return new URLSearchParams(params).toString();
}

export function deviceLabel(model: string, app: string): string {
  const name = model.trim().replace(/[\p{Cc}]/gu, '') || 'Android';
  return `${name} - ${app}`.slice(0, 64);
}

/** Map DSM's Auth.login reply. `step` is the step that was sent */
export function outcome(reply: NativeReply, step: 'password' | 'code'): SignInOutcome {
  if (reply.success) return { kind: 'done', scope: reply.scope };
  const code = reply.code;
  switch (code) {
    case 400: return { kind: 'error', error: 'wrongPassword', code };
    case 401: case 411: return { kind: 'error', error: 'accountDisabled', code };
    case 402: case 412: return { kind: 'error', error: 'noPermission', code };
    case 403:
      // A trusted phone never gets here; a phone whose trust was revoked asks again
      if (reply.types.includes('otp')) return step === 'code' ? { kind: 'error', error: 'wrongCode', code } : { kind: 'code' };
      if (reply.types.includes('fido')) return { kind: 'fallback', reason: 'passkey' };
      if (reply.types.includes('authenticator')) return { kind: 'fallback', reason: 'approve' };
      return { kind: 'fallback', reason: 'other' };
    case 404: return { kind: 'error', error: 'wrongCode', code };
    case 406: return { kind: 'fallback', reason: 'otpSetup' };
    case 407: return { kind: 'error', error: 'blocked', code };
    case 408: case 409: case 410: return { kind: 'fallback', reason: 'passwordChange' };
    case 414: case 416: case 419: return { kind: 'fallback', reason: 'approve' };
    case 498: case 499: return { kind: 'error', error: 'unavailable', code };
    default: return { kind: 'error', error: 'failed', code: code || reply.status };
  }
}

/** Native transport failures (see networkCause in the Android module) */
export function transportError(cause: string): SignInError | null {
  if (cause === 'cancelled') return null;
  return cause === 'certificate' ? 'certificate' : cause === 'tls' || cause === 'invalid' || cause === 'failed' ? 'failed' : 'unreachable';
}

/** `SYNO.API.Auth.Type` lists an account's methods; no `passwd` means a passwordless (passkey) account */
export function passwordless(body: string): boolean {
  try {
    const value = JSON.parse(body) as { success?: boolean; data?: Array<{ type?: string }> };
    return value.success === true && Array.isArray(value.data) && value.data.length > 0 && !value.data.some(item => item?.type === 'passwd');
  } catch { return false; }
}

/**
 * DSM's unauthenticated `SYNO.Core.Desktop.SessionData getjs` script. When the admin makes SSO
 * the default sign-in, DSM's own page goes straight to the SSO server; so does the App.
 */
export const SESSION_DATA_PATH = '/webapi/entry.cgi?api=SYNO.Core.Desktop.SessionData&version=1&method=getjs&SynoToken=';
export function ssoDefault(script: string): boolean {
  const flag = (name: string) => new RegExp(`"${name}"\\s*:\\s*true\\b`).test(script);
  return flag('sso_default_login') && ['sso_support', 'oidc_sso_enable', 'saml_sso_enable', 'cas_sso_enable'].some(flag);
}

export type SignInState = {
  step: 'password' | 'code';
  busy: boolean;
  error?: { error: SignInError; code?: number };
  fallback?: FallbackReason;
};
export type SignInTransport = {
  signIn(body: string, id: string): Promise<NativeReply>;
  cancel(id: string): void;
  /** GET a same-origin WebAPI JSON body without a session */
  authTypes(account: string): Promise<string>;
};

/** One sign-in screen's state. The password lives only here, in memory, until the screen closes */
export class SignInFlow {
  state: SignInState = { step: 'password', busy: false };
  private listeners = new Set<() => void>();
  private attempt = 0;
  private current?: string;
  private transport: SignInTransport; private newId: () => string;
  constructor(transport: SignInTransport, newId: () => string) { this.transport = transport; this.newId = newId; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getState = () => this.state;
  private set(patch: Partial<SignInState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  dismiss() { this.set({ error: undefined }); }
  /** Applies DSM's SessionData script; only an idle password step changes */
  sessionData(script: string) {
    if (ssoDefault(script) && !this.state.busy && this.state.step === 'password' && !this.state.fallback) this.set({ fallback: 'sso' });
  }
  back() { this.cancel(); this.set({ step: 'password', error: undefined }); }
  cancel() {
    this.attempt++;
    if (this.current) { this.transport.cancel(this.current); this.current = undefined; }
    if (this.state.busy) this.set({ busy: false });
  }
  /** Resolves with the scope once DSM accepted the sign-in and its cookies are in the jar */
  async submit(fields: SignInFields): Promise<string | null> {
    if (this.state.busy) return null;
    const step = this.state.step, attempt = ++this.attempt, id = this.newId();
    this.current = id;
    this.set({ busy: true, error: undefined });
    let result: SignInOutcome;
    try {
      result = outcome(await this.transport.signIn(loginBody(step === 'code' ? fields : { ...fields, code: undefined }), id), step);
      if (result.kind === 'error' && result.error === 'wrongPassword' && step === 'password') {
        try { if (passwordless(await this.transport.authTypes(fields.account))) result = { kind: 'fallback', reason: 'passkey' }; } catch {}
      }
    } catch (error) {
      const cause = transportError(String((error as { code?: string })?.code ?? 'failed'));
      result = cause ? { kind: 'error', error: cause } : { kind: 'error', error: 'failed' };
      if (!cause) { if (attempt === this.attempt) this.set({ busy: false }); return null; }
    }
    if (attempt !== this.attempt) return null;
    this.current = undefined;
    if (result.kind === 'done') { this.set({ busy: false }); return result.scope; }
    if (result.kind === 'code') this.set({ busy: false, step: 'code' });
    else if (result.kind === 'fallback') this.set({ busy: false, fallback: result.reason });
    else this.set({ busy: false, error: { error: result.error, code: result.code } });
    return null;
  }
}
