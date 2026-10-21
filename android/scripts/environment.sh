#!/usr/bin/env bash
# Shared local build environment. Caller uses bash and sources this file.
if [[ -z "${JAVA_HOME:-}" && -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
if [[ -z "${JAVA_HOME:-}" ]] && command -v /usr/libexec/java_home >/dev/null 2>&1; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
if [[ ! -d "$ANDROID_HOME/platforms/android-35" ]]; then
  echo '需要 Android SDK platform 35，请设置 ANDROID_HOME。' >&2; exit 1
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$PATH"
