#!/usr/bin/env bash
# Host wrapper: cache/signing/output locations are supplied outside the repository
set -euo pipefail
: "${MOBILE_BUILD_PREFIX:?Set a unique container name prefix}"
: "${MOBILE_ANDROID_SDK:?Set the Android SDK cache directory}"
: "${MOBILE_GRADLE_CACHE:?Set the Gradle cache directory}"
: "${MOBILE_NPM_CACHE:?Set the npm cache directory}"
: "${MOBILE_KEYSTORE_DIR:?Set a private signing directory outside the repository}"
: "${MOBILE_OUTPUT_DIR:?Set the APK output directory}"
repo_dir=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$MOBILE_KEYSTORE_DIR" "$MOBILE_OUTPUT_DIR" "$MOBILE_ANDROID_SDK" "$MOBILE_GRADLE_CACHE" "$MOBILE_NPM_CACHE"
case "$(realpath "$MOBILE_KEYSTORE_DIR")/" in "$repo_dir/"*) echo 'Signing keys must be outside the repository' >&2; exit 1;; esac
chmod 700 "$MOBILE_KEYSTORE_DIR"
exec docker run --rm --name "${MOBILE_BUILD_PREFIX}-android-build" \
  -e "MOBILE_TEST_FILES=${MOBILE_TEST_FILES:-}" \
  -e "MOBILE_NPM_REGISTRY=${MOBILE_NPM_REGISTRY:-https://registry.npmjs.org}" \
  -v "$repo_dir:/work" -v "$MOBILE_ANDROID_SDK:/sdk" \
  -v "$MOBILE_GRADLE_CACHE:/gradle" -v "$MOBILE_NPM_CACHE:/npm-cache" \
  -v "$MOBILE_KEYSTORE_DIR:/keystore" -v "$MOBILE_OUTPUT_DIR:/out" \
  "${MOBILE_ANDROID_IMAGE:-synopkgland-android:jdk17-cmdline16111833}" bash docker/android/build.sh
