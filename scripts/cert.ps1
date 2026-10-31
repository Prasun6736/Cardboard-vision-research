$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path "certs" | Out-Null

$task_lan_ip = if ($args.Count -gt 0) { $args[0] } else { "" }

$task_san = "DNS:localhost,DNS:visual-field.local,IP:127.0.0.1"

if ($task_lan_ip -ne "") {
    $task_san = "$task_san,IP:$task_lan_ip"
}

openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 365 `
    -keyout "certs/localhost-key.pem" `
    -out "certs/localhost.pem" `
    -subj "/CN=visual-field.local" `
    -addext "subjectAltName=$task_san"

Write-Host "Created certs/localhost.pem and certs/localhost-key.pem"
Write-Host "Trust this certificate on both devices."
Write-Host "Re-run as 'npm run cert -- 192.168.x.x' to include the desktop LAN IP."