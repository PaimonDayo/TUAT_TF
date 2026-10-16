#!/bin/sh
# Called only in the controller's new private mount namespace.
set -eu
[ "$#" -ge 3 ] || exit 64
app_uid="$1"
app_gid="$2"
shift 2
[ -d /mnt ] && [ ! -L /mnt ] || exit 65
# WSL's resolver symlink points into the share we must hide. Pin only that
# regular file before masking it; other Linux resolver paths stay untouched.
resolver=$(/usr/bin/readlink -f -- /etc/resolv.conf) || exit 65
keep_wsl_resolver=0
case "$resolver" in
  /mnt/wsl/resolv.conf)
    [ "$(/usr/bin/readlink -- /etc/resolv.conf)" = /mnt/wsl/resolv.conf ] || exit 65
    [ -f "$resolver" ] && [ ! -L "$resolver" ] || exit 65
    # FD3 belongs to Node's graceful-control IPC channel. Reserve another FD.
    [ ! -e /proc/self/fd/9 ] || exit 65
    exec 9< "$resolver"
    [ -f /proc/self/fd/9 ] && [ "$(/usr/bin/stat -Lc %u /proc/self/fd/9)" = 0 ] || exit 65
    keep_wsl_resolver=1
    ;;
  /mnt|/mnt/*) exit 65 ;;
  *) [ -f "$resolver" ] || exit 65 ;;
esac
/usr/bin/mount -t tmpfs -o mode=0555,nosuid,nodev,noexec,size=64k tmpfs /mnt
if [ "$keep_wsl_resolver" -eq 1 ]; then
  /usr/bin/mkdir -m 0555 /mnt/wsl
  : > /mnt/wsl/resolv.conf
  # Do not resolve the FD back to its now-hidden pathname/empty placeholder.
  /usr/bin/mount --no-canonicalize --bind /proc/self/fd/9 /mnt/wsl/resolv.conf
  /usr/bin/mount -o remount,bind,ro,nosuid,nodev,noexec /mnt/wsl/resolv.conf
  exec 9<&-
fi
# A non-/mnt canonical target can still have an unsupported alias through the
# hidden tree. Never launch with a resolver that became unreachable.
[ -f /etc/resolv.conf ] && [ -r /etc/resolv.conf ] || exit 65
if [ -d /opt/tuat-tf-supabase ]; then
  [ ! -L /opt/tuat-tf-supabase ] || exit 65
  /usr/bin/mount -t tmpfs -o mode=0555,nosuid,nodev,noexec,size=64k tmpfs /opt/tuat-tf-supabase
fi
exec /usr/bin/setpriv --reuid="$app_uid" --regid="$app_gid" --clear-groups --bounding-set=-all --no-new-privs "$@"
