#!/usr/bin/env bash
# Run inside the Android image with /sdk, /gradle, /npm-cache, /keystore mounted
set -euo pipefail
umask 077
cd /work
npm ci --no-audit --no-fund --cache /npm-cache --registry "${MOBILE_NPM_REGISTRY:-https://registry.npmjs.org}"
if [[ -n "${MOBILE_TEST_FILES:-}" ]]; then
  npm run typecheck
  npm run lint
  read -r -a test_files <<< "$MOBILE_TEST_FILES"
  node --experimental-strip-types --test "${test_files[@]}"
else
  npm run check
fi
npx expo prebuild --platform android --clean --no-install
mkdir -p /keystore /out
if [[ ! -e /keystore/package-land-release.keystore ]]; then
  if [[ ! -e /keystore/password ]]; then
    openssl rand -base64 32 > /keystore/password
  fi
  keytool -genkeypair -keystore /keystore/package-land-release.keystore \
    -storepass:file /keystore/password -keypass:file /keystore/password \
    -alias package-land -keyalg RSA -keysize 3072 -validity 10000 \
    -dname 'CN=Package Land, O=synopkgland' >/dev/null 2>&1
fi
chmod 600 /keystore/package-land-release.keystore /keystore/password
cd android
./gradlew --no-daemon --max-workers=2 -I /work/docker/android/signing.init.gradle \
  :webview-cookies:testDebugUnitTest assembleRelease -PreactNativeArchitectures=arm64-v8a -PreactNativeDevServerIp=localhost -Dorg.gradle.jvmargs='-Xmx3g -XX:MaxMetaspaceSize=768m'
cp app/build/outputs/apk/release/app-release.apk /out/package-land-arm64.apk
sha256sum /out/package-land-arm64.apk
