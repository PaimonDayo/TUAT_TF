#!/bin/sh
# Called only in the controller's new private mount namespace.
set -eu
[ "$#" -ge 3 ] || exit 64
app_uid="$1"
app_gid="$2"
shift 2
[ -d /mnt ] && [ ! -L /mnt ] || exit 65
/usr/bin/mount -t tmpfs -o mode=0555,nosuid,nodev,noexec,size=64k tmpfs /mnt
if [ -d /opt/tuat-tf-supabase ]; then
  [ ! -L /opt/tuat-tf-supabase ] || exit 65
  /usr/bin/mount -t tmpfs -o mode=0555,nosuid,nodev,noexec,size=64k tmpfs /opt/tuat-tf-supabase
fi
exec /usr/bin/setpriv --reuid="$app_uid" --regid="$app_gid" --clear-groups --bounding-set=-all --no-new-privs "$@"
