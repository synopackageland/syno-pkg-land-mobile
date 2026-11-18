# Ext component bridge (spike)

Research spike, not shipped. It checks whether a live DSM ExtJS component tree
can be drawn with `@synopackageland/ui` components while Ext stays the source
of truth.

- `bridge.mjs` reads a rendered Ext container (tabs, field sets, fields,
  buttons, grids), renders a Vue 3 view in a shadow root over it, and keeps
  both sides in sync: view edits call the Ext field's `setValue`, row taps call
  the grid's selection model, and buttons click the Ext button element. Unknown
  components are listed as "kept as Ext".
- `build.mjs` bundles it into one IIFE. Point `UI_DIR` at a built UI SDK
  checkout; Vite and Vue resolve from there, so this repo gets no new
  dependencies:

  ```sh
  UI_DIR=../syno-pkg-land-ui OUT_DIR=/tmp/bridge node spike/ext-bridge/build.mjs
  ```

  Output: about 504 KB minified, 132 KB gzip (Vue, UI SDK and theme CSS).

Inject the bundle into a signed-in desktop DSM page (DSM's CSP blocks inline
`<script>`, so use DevTools or `evaluateJavascript`), then call
`__splBridge.mount(<Ext container>)`. It never calls a WebAPI or presses Apply.
