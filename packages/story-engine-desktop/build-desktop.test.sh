#!/usr/bin/env bash
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_SCRIPT="$DESKTOP_DIR/build-desktop.sh"

# Load only declarations. The build starts below this marker and must never run
# during the security-gate unit tests.
# shellcheck disable=SC1090
DECLARATIONS_FILE="$(mktemp /tmp/se-desktop-declarations.XXXXXX)"
sed '/^# ---------- 主流程 ----------/,$d' "$BUILD_SCRIPT" > "$DECLARATIONS_FILE"
source "$DECLARATIONS_FILE"
rm -f "$DECLARATIONS_FILE"

TMP_ROOT="$(mktemp -d /tmp/se-desktop-security-test.XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

expect_failure() {
  if ( "$@" >/dev/null 2>&1 ); then
    echo "expected failure: $*" >&2
    exit 1
  fi
  return 0
}

PRESET_SRC="$TMP_ROOT/preset"
mkdir -p "$PRESET_SRC"
for file in model-settings.json model-secrets.json task-assignments.json; do
  printf '{"fixture":"%s"}\n' "$file" > "$PRESET_SRC/$file"
done

WITH_PRESET=1
unset SE_ALLOW_SECRET_BUNDLE || true
expect_failure validate_preset_bundle_request "$PRESET_SRC"

SE_ALLOW_SECRET_BUNDLE=wrong
expect_failure validate_preset_bundle_request "$PRESET_SRC"

SE_ALLOW_SECRET_BUNDLE=I_UNDERSTAND_KEYS_ARE_EXTRACTABLE
rm "$PRESET_SRC/task-assignments.json"
expect_failure validate_preset_bundle_request "$PRESET_SRC"
printf '{"fixture":"task-assignments.json"}\n' > "$PRESET_SRC/task-assignments.json"
validate_preset_bundle_request "$PRESET_SRC"

WITH_PRESET=0
CLEAN_STAGING="$TMP_ROOT/clean-staging"
mkdir -p "$CLEAN_STAGING/preset-model-config"
expect_failure assert_clean_staging_has_no_preset "$CLEAN_STAGING"
rm -rf "$CLEAN_STAGING/preset-model-config"
assert_clean_staging_has_no_preset "$CLEAN_STAGING"

PROBE="SE_CLEAN_BUILD_SECRET_PROBE_123456"
PACKAGED_OUTPUT="$TMP_ROOT/dist-electron/mac-arm64/StoryEngine.app/Contents/Resources/app"
mkdir -p "$PACKAGED_OUTPUT"
printf '%s\n' "$PROBE" > "$PACKAGED_OUTPUT/leak.txt"
expect_failure scan_clean_packaged_output "$TMP_ROOT/dist-electron" "$PROBE"
rm "$PACKAGED_OUTPUT/leak.txt"
scan_clean_packaged_output "$TMP_ROOT/dist-electron" "$PROBE"

STAGING="$TMP_ROOT/config-staging"
mkdir -p "$STAGING"
cp "$DESKTOP_DIR/electron-builder.yml" "$STAGING/electron-builder.yml"
WITH_PRESET=0
prepare_builder_config
grep -Fq '!preset-model-config/**' "$BUILDER_CONFIG"

WITH_PRESET=1
prepare_builder_config
grep -Fq -- '-with-model-preset.${ext}' "$BUILDER_CONFIG"
if grep -Fq '!preset-model-config/**' "$BUILDER_CONFIG"; then
  echo "preset builder config still excludes preset-model-config" >&2
  exit 1
fi

WITH_PRESET=0
assert_artifact_name_for_mode "$TMP_ROOT/StoryEngine-0.2.0-arm64.dmg"
expect_failure assert_artifact_name_for_mode "$TMP_ROOT/StoryEngine-0.2.0-arm64-with-model-preset.dmg"
WITH_PRESET=1
assert_artifact_name_for_mode "$TMP_ROOT/StoryEngine-0.2.0-arm64-with-model-preset.dmg"
expect_failure assert_artifact_name_for_mode "$TMP_ROOT/StoryEngine-0.2.0-arm64.dmg"

# Persistent outputs must never mix a previous secret-bearing preset artifact
# into a later clean build's directory or current-run listing.
OUT_ROOT="$TMP_ROOT/persistent-output"
mkdir -p "$OUT_ROOT/clean"
printf 'old-clean\n' > "$OUT_ROOT/clean/old-clean.dmg"
WITH_PRESET=1
prepare_mode_output_dir
printf 'preset\n' > "$OUT_DIR/StoryEngine-0.2.0-arm64-with-model-preset.dmg"
test -f "$OUT_ROOT/clean/old-clean.dmg"

WITH_PRESET=0
prepare_mode_output_dir
printf 'clean\n' > "$OUT_DIR/StoryEngine-0.2.0-arm64.dmg"
test ! -e "$OUT_ROOT/clean/old-clean.dmg"
test -f "$OUT_ROOT/with-model-preset/StoryEngine-0.2.0-arm64-with-model-preset.dmg"
test -f "$OUT_ROOT/clean/StoryEngine-0.2.0-arm64.dmg"
CURRENT_OUTPUT="$(list_current_mode_artifacts)"
case "$CURRENT_OUTPUT" in
  *with-model-preset*)
    echo "clean current-run listing exposed an old secret-bearing artifact" >&2
    exit 1
    ;;
esac

echo "desktop security gate tests passed"
