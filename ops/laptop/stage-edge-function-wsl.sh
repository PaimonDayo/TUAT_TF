#!/bin/sh
# Stage code only. Push stays inactive until secrets, hooks and networking are configured.
set -eu
source_dir='/mnt/c/Paimon Dayo/TUAT_TF/supabase/functions/send-web-push'
target_dir='/opt/tuat-tf-supabase/volumes/functions/send-web-push'
if [ -e "$target_dir" ]; then echo 'Function already staged; refusing to overwrite'; exit 1; fi
install -d -m 0700 "$target_dir"
cp "$source_dir/index.ts" "$target_dir/index.ts"
cmp "$source_dir/index.ts" "$target_dir/index.ts"
echo 'Push function source staged. Secrets and external calls remain unconfigured.'
