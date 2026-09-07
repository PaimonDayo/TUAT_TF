#!/bin/sh
set -eu
package='/opt/tuat-tf-supabase/cloudflared.deb'
curl --fail --silent --show-error --location --proto '=https' https://github.com/cloudflare/cloudflared/releases/download/2026.8.3/cloudflared-linux-amd64.deb -o "$package"
printf '%s  %s\n' '660b348d473bba81997445b534e7eaefaf4c4e16331866922326c338a7013dd9' "$package" | sha256sum -c -
dpkg -i "$package"
cloudflared --version
