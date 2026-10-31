#!/usr/bin/env bash
set -euo pipefail
mkdir -p certs
task_config_file="shared/config.ts"
config_string() {
  sed -n "s/^[[:space:]]*$1: '\([^']*\)'.*/\1/p" "$task_config_file"
}
task_lan_ip="${1:-$(config_string unixCertificateLanIp)}"
task_certificate_file="$(config_string pemCertificateFile)"
task_private_key_file="$(config_string pemPrivateKeyFile)"
task_san="DNS:localhost,DNS:visual-field.local,IP:127.0.0.1"
if [[ -n "$task_lan_ip" ]]; then
  task_san="$task_san,IP:$task_lan_ip"
fi
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 \
  -keyout "certs/$task_private_key_file" -out "certs/$task_certificate_file" \
  -subj "/CN=visual-field.local" \
  -addext "subjectAltName=$task_san"
echo "Created certs/$task_certificate_file and certs/$task_private_key_file"
echo "Trust this certificate on both devices. Re-run as 'npm run cert -- 192.168.x.x' to include the desktop LAN IP."
