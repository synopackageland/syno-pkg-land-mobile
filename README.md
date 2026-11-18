# Package Land mobile

Private Expo Android shell for registered NAS apps. Expo SDK 58, React Native 0.88 and WebView 14 are pinned by the lockfile. Android 10 or later sideload builds are the current target.

`variants/land` provides the Package Land launcher. The Apps tab holds a dense grid of NAS Apps. The NAS tab lists saved NAS and opens each one's details. The top bar slides away as you scroll down and returns when you scroll up. Both bars are translucent with a hairline edge: a system blur on iOS, an `expo-blur` RenderNode blur of the list below on Android 12 and later, and a 94% opaque surface on older Android. The launcher icon, adaptive icon and splash use the Package Land brand artwork in `assets/brand`. The title opens a quick NAS switcher. All copy comes from `src/core/i18n/strings.ts` (en, zh-Hant, zh-Hans).

Add NAS takes one address: a name, an IP address or a URL. Typing never probes. Test connection (or Enter) asks DSM's API Info endpoint in the background, with Cancel. It tries HTTPS then HTTP, on the typed port and then on 5001 and 5000, and shows the cause for every candidate that fails. The first DSM answer is chosen, and any other answering address can be picked instead. The name defaults to the DSM server name from the login page title, then to the host.

Certificate states:
- Trusted: no extra step.
- Self-signed or hostname mismatch: shows the SHA-256 fingerprint and needs an explicit trust tap. The fingerprint is then pinned for that origin only.
- Changed pin: red warning; trusting the new certificate is a red confirmation.
- Plain HTTP: allowed with a warning.

QR codes and `synopkgland://add-nas` links add or update grouped profiles after a confirmation.

NAS details:
- Rename, change the address (re-probe and re-pin; the old origin's session is cleared), check the connection, and re-trust a changed certificate.
- Sign out and Remove use a red confirmation sheet that shows the full origin. Both clear that NAS's session cookies, IndexedDB and other quota-managed storage, snapshot and share inbox. Sign out keeps DSM's trusted-device cookie (`did`), like DSM's own "remember this device"; Remove clears it too. Because localStorage survives that clearing, sign-out and each native sign-in also write a new nonce; the next document at that origin removes DSM's page resume data (`crossPortData` and `lastHS`) once at document start, so a DSM page never resumes the previous account.

Sign-in is native. The App's form calls `SYNO.API.Auth login` (version 6, session `webui`) through the same isolated exchange, with `enable_device_token=yes`, a device name (phone name and App name) and a stable per-install `mobile_id`. DSM answers unknown session names with 402, so the App uses DSM's own `webui` session, which WebView Apps share. Keep me signed in sends `rememberme=1` and is on by default. An account with a TOTP code gets a second step that repeats the request with `otp_code`; each success registers the phone as a trusted device, so DSM skips the code next time until the device is revoked or expires. DSM's `id` and `did` cookies go straight into the WebView cookie jar, after the origin's IndexedDB and other quota-managed storage are cleared. The password stays in the form's memory and is never stored. Errors (wrong password or code, disabled account, blocked IP, no permission, unreachable NAS, changed certificate) show a message with a fix. The core logic is `src/core/session/native-sign-in.ts`; other shells reuse `SignInFlow` and the native `signIn` with their own UI.

Use DSM web sign-in opens DSM's page with one tap. The form switches to that button for passkeys or hardware keys, Secure SignIn approval, a forced or expired password change, an account that must set up 2-step verification first, and a NAS whose default sign-in is SSO (read from DSM's unauthenticated session data).

Authentication stays in Android's WebView cookie jar; the shell never persists a password or token. On the web page, only same-origin `SYNO.API.Auth.login` POSTs use an isolated native HTTP/1.1 exchange, avoiding a stalled Auth stream on the WebView's shared HTTP/2 connection. Request bodies remain in memory for the exchange and never enter URLs or logs. Other requests keep the normal WebView transport.

Auth replies still reach DSM through real XHR/fetch responses, including wrong-password and 2FA challenges. The native transport enforces the same origin and confirmed certificate leaf, refuses redirects, and waits for cookie-store callbacks before reporting a successful authenticated session. The sign-in screen closes on that event without waiting for navigation, disk flush or discovery. Launcher refresh runs in the background while the retained DSM view continues loading its runtime. Sign-out, navigation and view teardown invalidate pending requests.

The Apps grid shows validated `mobile.json` registrations first, then the DSM layout section: DSM's own pages for every other App, fitted to the phone (see DSM mobile fit). Every App opens on the first tap. These targets always use the desktop preset with no bridge injected. Long lists get search. Offline refresh keeps the cached list with a banner that names the cause and offers Retry. A manual App path or registration toggle is not part of the launcher.

The launcher reads its persisted names, icons and targets synchronously before starting discovery. Snapshots are separated by NAS profile and a one-way fingerprint of the DSM login cookie, so another user's snapshot never renders after a user switch. A new login session refreshes its own snapshot. Offline refresh leaves the cached list visible; an explicit authentication failure clears it. Pending shares remain in memory only.

Discovery reads `login.cgi?enable_syno_token=yes` with WebView cookies, then `SYNO.Core.Desktop.Initdata`; see DSM launcher visibility for the filter.

Every package candidate probes its own `app/mobile.json`. Only HTTP 200, valid JSON, schema 1, matching package identity, supported shell version/capabilities/intake rules and a same-origin package entry enable mobile mode. Desktop URLs preserve same-origin URL launchers or use DSM's original launch ID. The launcher never needs the administrator-only AppPortal alias API, so its normal-user 105 cannot block discovery. Registered Apps open their canonical entry; portal rewriting and fallback remain the SDK entry's responsibility. HTTP 200 JSON API errors are failures. Slow reads are hedged after four seconds without aborting the original request, and successful registration probes appear progressively.

## NAS status on the home page

The home page leads with a NAS card and a resources card: CPU and memory rings, then three small tiles for network, drive activity and storage. The storage tile answers "am I running out of space?": it shows the volume closest to full (used %, used / total and a thin bar that turns warning at 80 % and danger at 90 %). With several volumes, the fullest one is named and a "+N" badge counts the others. A crashed, degraded or read-only volume wins over the fullest one and shows its state in danger colour. Tapping the tile opens the status page on its storage section. DSM refuses the storage API to normal users, so for them the third tile shows the temperature. Volumes refresh every 60 seconds inside the same compound request as the other status items, and only while the home page is visible.

Home, Apps, Notifications and the status page refresh on a pull from the top (`variants/land/PullRefresh`, passed as a list's `refreshControl`). Android uses the platform's RefreshControl; the browser build draws the same Material indicator itself, only for a touch pull that starts at the top of the list, and keeps the browser's own pull-to-reload off. The spinner answers only a pull: background refreshes stay quiet, and data on screen stays until the reload replaces it.

Notification read marks stay on the phone and are not synced back to DSM. The App does not use push notifications.

## Core interfaces

- `src/core/config.ts`: `ShellConfig` (launcher or single mode), `NasProfile`, `AppTarget`, `Launch`
- `ShellScreen({config, profile, target, active, launch, onExit, onAuthenticated, safeAreaEdges})`: mounts a WebView immediately, configures Android's origin-scoped document-start transport while it is blank, then starts the entry URL. Supplying `onAuthenticated` opts into the shared sign-in transport and verified session completion. Hardware back uses page history, then `onExit`. Standalone screens pad top/bottom safe areas; the launcher supplies its own padding and passes empty edges
- `ShellPool`: retains the last two targets; background/resume does not reload. Renderer loss remounts from the canonical entry. Loading and blank documents keep recovery controls above the WebView, in normal layout, so they cannot cover the App's navigation. Retry remounts from the canonical entry
- `LauncherModel`, `launcherStorage`: synchronous profile/snapshot state and background discovery, with late-response guards on user/profile changes
- `createDiscovery(readJson, language)`: permission filtering and validated registration mapping; `DiscoveredApp` extends `AppTarget` with display metadata and the declared start route
- `Native.takePendingIntake()` and `Native.addListener('onIntake', listener)`: cold and warm Android shares. Payloads contain URL/text or bounded file bytes, never content URIs
- `acceptsIntake(items, declaration)` checks schemes, MIME/extensions and declared byte limits. `IntakeInbox.put(id, origin, items)` / `take(id, origin)` / `clear()` implement origin-bound read-once handles. Use random handles and clear on sign-out/profile removal
- Cold launch uses `link` and `intake` URL parameters; updating the `launch` prop delivers the contract event after the page is ready. A launcher chooses the target, passes the declared intake route and never places shared contents in a URL
- Intake matches all shared items against registered targets' accept rules, including `max_bytes`. One target opens immediately; several show a picker; none shows an explanation. A fresh discovery finishes its registration set before deciding among newly discovered intake targets

`spec/native/v1/contract.json` and `src/core/bridge/contract.gen.ts` mirror the SDK's wire contract. The local schema drift check runs in `npm run lint`. TODO: replace the mirror import with `@synopackageland/sdk/mobile/shell` after that subpath is released. `Context.host` remains the SDK's HostAdapter; this shell does not replace it.

## Native behaviour

Registered mobile targets expose `SynoPkgNative` only in the NAS-origin main frame. Android independently checks the source origin and `isMainFrame` on every privileged message; subframes get no public bridge or forwarding shim. WebViews must support AndroidX `WEB_MESSAGE_LISTENER` and `DOCUMENT_START_SCRIPT`; otherwise registered mode shows an update message and fails closed.

Downloads stream in-process with WebView cookies and a same-origin check before every redirect. Downloads never use Android DownloadManager. Base64 downloads stay within the advertised 50 MiB decoded limit. Completed files offer Share or Save to Downloads through MediaStore. Downloads acknowledge before I/O and emit ready before presenting Share/Save actions. Native cache and MediaStore filenames independently replace path separators, reserved characters and controls. Progress and final action states follow the SDK contract; file paths, cookies and tokens never return to the page. Cache cleanup removes only files older than one day.

`openExternal` accepts HTTP(S), requires current user activation and permits one launch per second. Camera permission is requested when a registered page uses an image file input or live camera. Plain HTTP advertises capture; HTTPS advertises live camera. Audio and storage permissions are blocked. Desktop-view media capture is denied, while the OS file chooser remains available.

The native safe area pads the screen and the module zeroes WebView window insets. Splash hides at FCP, with display-only safety hides after 10 seconds or 4 seconds after load end. These timers never cancel network requests. Cleartext LAN connections show a warning; untrusted HTTPS certificates receive the platform's normal rejection unless the user confirmed that origin's exact QR leaf fingerprint.

## Browser build

The same source also builds a web page that a NAS package serves from its own
DSM origin, for phones without the App:

```sh
npm run build:web                                  # relative: works from any folder
WEB_BASE_URL=/apps/land npm run build:web          # or for one fixed path
```

The output in `dist/web` holds the page, a PWA manifest (installed, it opens
full screen without the address bar) and `build.json` with the source commit
and every file's SHA-256, so a host that vendors the build can check it.

Added to a home screen, the page opens like an App: its own name, icon (180 px
`apple-touch-icon`, 192/512 px and a maskable 512 px icon) and a white status
bar; the bars clear the notch and the Home indicator. Until then the home page
shows a small card in its content, never over it (`variants/land/InstallHint.web.tsx`,
`src/core/install`): iPhone and iPad Safari get the steps Share › Add to Home
Screen › Add, and a browser that fires `beforeinstallprompt` (Chrome on Android)
gets an Add to Home Screen button. Other browsers, added pages, frames and the
native App never show it. Closing it is kept in localStorage
(`spl:install-hint-dismissed`). Its copy has the UI kit's nine locales.

Platform differences live only in `*.web.ts(x)` files next to the Android ones:

| Module | Browser build |
| --- | --- |
| `modules/webview-cookies` | Same-origin `fetch`; DSM's own `Auth.login` with the native form; sign-out ends the browser's DSM session; the session key is a one-way fingerprint of the SynoToken |
| `src/core/webview/ShellScreen` | A same-origin iframe. The mobile fit script and its reports are added to each new document; with the fit off, the desktop layout is scaled to the width |
| `src/core/back` | One history entry per back step (a tab, a pushed page, an open App, a sheet, a step inside a DSM App), see `src/core/web-history.ts`. The browser's back and Android's swipe-back go through an App frame's own pages first, then run the same handlers as Android's back. Each entry keeps its screen, so a reload reopens it |
| `src/core/files` | localStorage instead of files |
| `src/core/platform`, `src/core/boot` | One NAS, the page's own DSM; the session is read before the first render |
| `src/core/icons/store`, `src/core/transfers/download` | DSM icons from the browser cache; browser downloads |

Each page is one NAS, its own DSM: no QR, address or certificate management.
Several NAS work like this instead (`src/core/profiles/nas-links.ts`,
`remote.web.ts`):

- Tapping the NAS name opens the same switcher as the App. It lists this NAS,
  then the NAS it links to. Picking one opens that NAS's own launcher, so the
  DSM session stays with each origin and the first visit signs in there.
- Every origin keeps the list in its localStorage. A switch hands it over in the
  URL fragment (names, addresses and change times, never credentials); the next
  page merges it, newer entry per NAS first, and removes it from the address.
  A removed NAS stays as a dated tombstone so an older list cannot bring it back.
- Add NAS takes a DSM address, a host or a relay domain and looks for the
  launcher at the same path on DSM's usual ports, in a hidden frame that only a
  launcher answers (`public/index.html`, `?spl-probe=1`). A NAS without it gets
  Open DSM (new tab) and Add anyway. An HTTPS page skips plain HTTP addresses.
- Other NAS show whether they answer: a credential-free request whose reply is
  never read, in the background when the switcher opens. Remove forgets only
  the link.

Registered Apps run inside a frame, where the SDK's native bridge is
not offered (it only trusts a top frame), so they use the SDK's browser
fallbacks; there is no share target or intake. Home still works: a registered
App's frame is named `synopkg-shell:1:close`. The UI kit's top-left Home, on
every page of the App, posts `{ v: 1, type: 'close' }` to this page, which
leaves the App right after a tap, as the bridge's `close` does on Android
(`src/core/webview/shell-frame.ts`).

Inside the launcher the UI kit makes each sub-page a history entry of the App,
pushed on the tap that opens it. In the browser, those entries come before the
launcher's in the tab's history, so back closes sub-pages first; Home walks back
by the launcher's own entries (`ownEntryBack`). On Android, back goes through the
WebView's history before it leaves the App. DSM must allow being framed by
its own origin, which is its default. Push notifications are not used.

An App frame stays hidden under the launch cover until the App is ready: a DSM
App once its window shows (the fit reports it), any other page once it has drawn
something. The cover's arc and fade are CSS animations, so they keep running
while DSM's scripts hold the page's main thread.

## Release version

The Android release version lives in `variants/land/config.json`: `version`
becomes Expo's versionName and `versionCode` is the Android upgrade counter
(currently 0.3.2 / 6). Increase both for a new release and keep the npm package
and lockfile versions aligned. Reuse the existing external release signing
directory; replacing the keystore prevents installed copies from upgrading.

Publish the signed arm64 build as `package-land-arm64.apk` and a `SHA256SUMS`
file with the line `<sha256>  package-land-arm64.apk` on the matching `v<version>`
GitHub release. The public download relay pins that release's size and hash.
List user-facing changes for each version in `CHANGELOG.md`.

## Docker builder

Run gates in the Android image:

```sh
docker run --rm -v "$PWD:/work" synopkgland-android:jdk17-cmdline16111833 npm ci --no-audit --no-fund
docker run --rm -v "$PWD:/work" synopkgland-android:jdk17-cmdline16111833 npm run check
```

The image uses JDK 17 and Android command-line tools 16111833. `docker/android/Dockerfile` can rebuild it; optional proxy trust certificates belong in its ignored `ca/` directory. Reuse shared SDK, Gradle and npm caches. Supply these host environment variables before running `docker/android/run.sh`:

| Variable | Purpose |
| --- | --- |
| `MOBILE_BUILD_PREFIX` | Unique disposable container prefix |
| `MOBILE_ANDROID_SDK` | Existing writable Android SDK directory |
| `MOBILE_GRADLE_CACHE` | Shared Gradle cache directory |
| `MOBILE_NPM_CACHE` | Shared npm cache directory |
| `MOBILE_KEYSTORE_DIR` | Private directory outside the repository |
| `MOBILE_OUTPUT_DIR` | APK output directory |
| `MOBILE_ANDROID_IMAGE` | Optional image override |
| `MOBILE_NPM_REGISTRY` | Optional npm registry override for the build |

The build runs `npm ci`, focused checks, clean Expo prebuild and `assembleRelease` for `arm64-v8a`. Android native project files are generated and ignored. The output is `package-land-arm64.apk`. Native debugging is enabled for this sideload version.

Development builds can set `MOBILE_TEST_FILES` to space-separated related test paths. The builder always runs TypeScript, lint, contract checks and the native filename unit test before assembling the APK.

The first build creates `package-land-release.keystore` and `password` in the external signing directory, with mode 600. Gradle reads passwords from the mounted file; neither passwords nor keystore bytes enter process arguments or source control. Preserve this signing directory for future updates of the installed app. Keystores and local environment files are ignored.

## LAN fixture and device handoff

Run `node scripts/fixture-server.mjs` on a LAN-accessible machine. It serves ports 8787 and 8788 by default (`PORT` overrides the first). Add that machine's first HTTP origin as a NAS, open its simulated sign-in page, then return to the launcher. Discovery offers Shell fixture as a registered App and Desktop fixture as a desktop-layout App; Denied fixture is filtered out. The simulated portal API returns 105. The second port is a different origin for negative checks. It also answers the DSM API probe, so the add-device flow detects it; set `FIXTURE_APPS=100` to add 100 generated desktop Apps for long-list checks. The server carries no NAS credentials and prints only its listening ports.

The fixture offers base64/URL/blob downloads, Share/Save, a cross-origin download redirect rejection, external links, intake read-once, a camera input, a next page for back, a long form with a password field near the bottom (`/form`, which shows `innerHeight` and `visualViewport` for keyboard checks), and same/foreign-origin iframe checks. Set the second port as a separate profile to check a different origin in desktop mode has no bridge. Live `getUserMedia` needs a trusted HTTPS fixture; the HTTP fixture exercises capture fallback.

The emulator-free tests validate protocol handling, read-once storage, capability/activation checks, URL policy, intake matching, and script execution under main-frame/foreign-origin/subframe contexts. Android compilation establishes packaging, not phone acceptance. On an authorized Android device, verify installation, native source/frame rejection, cold/warm shares, both download actions, camera prompts, back and warm resume. Use a test NAS's own DSM login page to verify cookie persistence across force-stop and restart. Record device results separately.

## DSM launcher visibility

The launcher shows what the user's DSM main menu shows, DSM's built-in Apps
included (Control Panel, File Station, Resource Monitor, Storage Manager,
Package Center, Log Center and others), in DSM's main-menu order.

Discovery reads DSM's `Desktop.Initdata.get_user_service` and `get_ui_config`,
`Core.Package.list` with `status` and `dsm_apps`, and DSM's `Desktop.Defs`
(hardware flags) and `Desktop.UIString` (global UI strings) scripts, using the
current session. The scripts are parsed as JSON, never evaluated. Grants follow
DSM's `StatusNotifier.isAppHasPrivilege`: AppPrivilege (including alternate
privilege IDs), user type, local/domain scope, ActionPrivilege for delegated
administrators, and `allUsers` or administrator for Apps without a grant. Hidden,
non-launchable, disabled-service, stopped-package and launch-condition entries
are left out. A hardware flag (`supportKey`) is evaluated against Defs like
DSM's `AppUtil.isSupportedType`. If Defs cannot be read, an entry DSM listed in
its own last main menu is shown, and any other waits until the live DSM runtime
confirms it. HA safe mode hides every App. DSM Help and Support Center are
never listed. Package status maps through DSM app
IDs, which can differ from package IDs and UI folders. A failed package-state
read cannot publish an unverified replacement list.

App names follow the App's language (English, Traditional or Simplified
Chinese), not the DSM account's. Discovery reads send the matching
`Accept-Language`, which DSM uses for package strings, and ask `UIString` for
that language; if that read fails, the account's language and then English are
used. The language is read again on every refresh. The snapshot keeps names per
language, so switching back shows that language's cached names at once; icons
are cached independently of language.

Built-in Apps use DSM's own icons (cached and keyed by the DSM build), open in
the DSM layout as single Apps through DSM's `launchApp`. They are not probed
for `mobile.json`. With the phone fit switched off they still appear and open in
the plain desktop layout. This is launcher UX; DSM still enforces access when
an App opens.

Entry recovery observes same-origin main-frame content without a readiness
deadline or network cancellation. Load-end alone does not dismiss the launch
cover. Native `onPageStarted` starts a document attempt; Android's history/hash
`onLoadStart` notifications do not reset readiness. Document commit starts the
content probe even if load-end is delayed. Both bridge FCP and observed content
dismiss the launch cover and release queued launches.
The cover is centered over the WebView, which keeps loading underneath: the
App icon with one arc in the App color turning around it (no track), and the
App name. With the system "remove animations" setting the arc stays still. It
appears on the first frame, since a DSM App never paints sooner, and fades out
over 220 ms when content is ready.
After 8 s it adds "Still opening" with Reopen and Back; a slow App is never
judged failed by time alone.
A failed main-frame navigation offers Reopen and Back, and stale content
messages cannot dismiss a failed or replaced attempt. No App-specific portal
paths are used.

DSM Apps open in one warm DSM page when the mobile fit is on. Once the launcher
is signed in, a hidden page boots DSM with Personal Settings (every account has
it), and each DSM App then opens inside it through DSM's own `SYNO.SDS.AppLaunch`,
so DSM does not boot again for every App. Home or back closes the App's window
and keeps the page. An App DSM does not list, a loaded page that has not offered to
host the App 8 s after the tap, an App that stops on a script error before its window
exists (reported about a second later), or a dead page (expired session, DSM
restarted, a load error) opens the App in a fresh page of its own, with the
cover. An App that has started in the warm page keeps it however long DSM
takes. On Android the WebView's inset, bridge and fit setup run together
before the first navigation. Registered
Apps keep their own entry. The top-left button in a DSM App's bar is Home: it
always returns to the launcher.

Edge-to-edge windows are not resized for the keyboard. The WebView module
reports the keyboard top, and each shell pads its frame by the part the keyboard
covers. The page viewport (`innerHeight`, `visualViewport`) shrinks without
rescaling, and the WebView scrolls the focused field into view.

The selected NAS's DSM sign-in WebView remains mounted while signed in, hidden
and inactive outside the login screen. It continuously reads
`StatusNotifier.isAppHasPrivilege` and `AppUtil.isValidApp` from the actual DSM
runtime, so late autoLaunch privilege overrides also remove raw discovery
candidates. Reports are bound to the NAS origin and current session fingerprint.
They filter both displayed and persisted lists, and late registration probes
cannot restore denied entries. Unknown runtime decisions retain the existing
raw policy. Switching NAS or signing out discards this runtime state; sign-out
also unmounts the DSM view. The shell does not interpret package extension code
or add package-specific visibility exceptions.

Background discovery preserves a cached mobile registration until that
package's probe settles. App list changes wait until a card press has finished,
so refresh cannot move the pressed tile between sections. Opening
starts immediately without awaiting discovery. If no WebView acknowledges the
request after three seconds, the shell offers Retry above the App view.
`adb logcat -s SynoPkgOpen:I` records `press_started`, `press_released`,
`tap_received`, `open_requested`, `webview_created`, `open_waiting` and retry or
rejection stages with a local request sequence only. A warm retained WebView
also acknowledges a new open request. Logs contain no App IDs, URLs, session
fingerprints, credentials or shared content.

`adb logcat -s SynoPkgSignIn:I SynoPkgSession:I` records fixed sign-in stages
(request, response, cookie commit, authentication, launcher and refresh) and
native discovery read sequences with elapsed milliseconds. It records no page
content, URLs, NAS names, cookies or request bodies.

## Add NAS by QR

Add NAS offers Scan QR through Expo Camera. Camera access is requested only on
that action. Denial, unavailable camera and invalid codes leave manual URL entry
available. Android system cameras can open `synopkgland://add-nas#…`; cold and
warm intents go to the same confirmation UI, never the App share inbox.

Version 1 is unpadded base64url of at most 2,048 bytes of UTF-8 JSON, with `v`,
`name` and 1–8 ordered `urls` entries. Only HTTP(S) origins are accepted; paths,
queries, fragments, credentials, controls, invalid kinds and non-lowercase
SHA-256 pins are rejected. Unknown fields are discarded. Unsupported versions
ask for an App update. The shared `tests/qr-v1-fixture.json` carries payload JSON
and the exact QR string used by the Connect implementation.

Confirmation shows the NAS name, address kinds, HTTP warnings and exact leaf
fingerprints. Each address becomes an origin-scoped profile under the same NAS
name and group, in the supplied preference order. The NAS list shows address kind
and host. This release deliberately uses separate sign-ins and snapshots and
requires choosing the address when moving off LAN. A single automatically
failing-over profile would need changes to origin-bound cookies, discovery,
bridge authorization, downloads and retained WebViews; cookies are never copied
between hosts. Manual single-origin profiles and their data remain valid.

Rescanning any saved origin updates that whole group after confirmation, retains
IDs/cookies/snapshots for unchanged origins and removes obsolete local profiles
and sessions. The wire format has no stable NAS ID; completely disjoint address
sets cannot be identified as the same NAS, and equal names alone never merge
unrelated machines.

Confirmed SHA-256 fingerprints are per complete HTTPS origin, including port.
Native discovery and downloads install a connection-local leaf verifier.
WebView TLS errors may proceed only for that reviewed leaf, with certificate
validity checked. Document commit/finish and privileged bridge messages also
check the current leaf, including replacements trusted by Android; a different or expired untrusted leaf follows the existing
WebView failure/retry flow. Updating or deleting pins clears WebView SSL decision
caches. There is no global trust-all manager, wildcard host exception, or silent
pin rotation. QR UI strings have Traditional Chinese, Simplified Chinese and
English variants, with English fallback for other locales.

## DSM mobile fit

Each NAS has a "Fit DSM Apps to the phone" switch in its device page. It
defaults to on when the screen's short side is under 600 dp and off on tablets.
When it is on, `src/core/webview/mobile-fit/` is injected into desktop-preset
DSM Apps through a separate document-start script with no bridge transport
(`bindFit`). It sets a device-width viewport, so DSM's own Vue window shell
switches to its narrow layout, and fits Ext windows, wizards, forms and grids
to the phone. An App's side navigation (`SYNO.ux.ModuleList` in a
`PageListAppWindow`, Storage Manager's sidebar, or a tree in the west region of
the split that holds most of the window, even beside an icon rail or inside a
padded main panel, as in Synology Drive and Active Backup's Portal, or a list
of the App's items in Ext DataViews that takes 30% or more of the phone, as
Synology Chat's channels) becomes a menu behind a hamburger in the title bar,
like Control Panel's own; that split's top bar grows when its items wrap onto a
second line. It changes
presentation only; DSM itself already maps long-press and double-tap. In a
single App, a box with a stylesheet height whose content spills over what
follows (Package Center's detail header) grows to its content, an image wider
than the box that clips it (a screenshot carousel) is scaled to the box with an
expand button, and hidden windows keep out of the page's scroll width. A main
panel padded for a desktop window (24 px or more a side) keeps 12 px gutters and
the full width; floated cards side by side whose content wraps at their share
of the row stack, each at the row's width; and a box set to a desktop min-width
is capped even over a background picture when it holds controls. A flex row
that fits only by crushing an item under 80 px wraps, also before the readable
width decides whether to widen; a number and its unit ("1.2 TB") never break
apart; a menu in a card header gives up its desktop width; DSM Vue's label/value
cards put each label and its value on one line; expandable list rows contain
what floats in them; a panel floating past the screen (a search's options) is
narrowed to it and moved inside; and a desktop width or minimum width wider
than the phone is dropped, the box filling its container instead. A row of
flexed cards that the App fills only after the row is laid out (Virtual Machine
Manager's overview counts) is laid out again once filled, so it becomes a grid
like any other card row. A package page that runs its own copy of DSM's desktop
(`#sds-desktop` and `#sds-taskbar` on a page other than DSM's root, as
Surveillance Station does) becomes a list of the Apps in its main menu: its
taskbar, desktop icons and main menu with their dark backdrop are hidden, and
a tapped row opens that App with the page's own `SYNO.SDS.AppLaunch` as a full
screen single App, back returning to the list. The list comes from DSM's
structure, never from App names: the app view's components (`sds-appview`), or
on desktops drawn without them (Surveillance Station 9) the desktop icons
(`li.launch-icon[syno-id]`). A tap shows the App's icon with a turning
arc (no track) and its name at once, until its window shows without DSM's
loading mask; there is no time limit, and back while it opens cancels it and
closes the window when it comes. A window still under DSM's loading mask
comes into view after 1.5 s, under that mask. App windows are Ext windows or Vue
components; a Vue 3 component has `$` and `$el` instead of `_isVue`, and the
fit checks for both (`isVue()`). With reduced motion the arc stays still.
A side region of a border layout that crushes the content on a phone stacks
with it (`stackSides()`) and folds to a bar with its label, which opens on a
tap. Panes laid out side by side with flex boxes do the same (`foldPanes()`): a
row taller than half the screen whose fixed panes leave the growing pane under
60% of it becomes a column, each fixed pane a bar. Panes fold before they are
painted: under the opening cover, and as the page adds them. A dialog whose content runs
past its own edge wraps that row and scrolls (`sheets()`); a small box pinned over its
lower half that the text then runs under joins the flow after it. A card header whose
short title or switch of buttons breaks onto a second line wraps, title above the switch;
cards of a wrapped row that each take a line fill it, and one that centred its content over
its desktop height takes its content's height with a top padding like its other sides
(`wrappedCards()`). A page-sized box that hides
overflow scrolls once its content runs past its bottom (`clippedPages()`). A Vue toolbar's
buttons take what they need and its search and filter fields share the rest. DSM Vue's
label/value cards drop an "undefined:" label (a column with no title) and a label whose
value is empty. A row of a name, a meter and its value that scrolled sideways puts the meter
and value under the name, and its box grows instead (`meterRows()`). A card grid whose last
row would be half empty uses fewer columns, and the cards of a short last row share its width;
a list squeezed under a card grid takes its content's height and the box scrolls instead
(`fitFlexed()`, `flexedRows()`). Every CSS rule is scoped to
`html.spl-fit`, and all but the package page's list to below 600px.
Edit `dsm-fit.js` or `dsm-fit.css`, then run
`node scripts/gen-mobile-fit.mjs`; `tests/mobile-fit.test.ts` fails when
`fit.gen.ts` is stale.
`spike/ext-bridge/` is a research spike that is not shipped.
