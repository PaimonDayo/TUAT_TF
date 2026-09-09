# Owner requested that McAfee VPN stop reconnecting. Only this VPN adapter is changed.
$ErrorActionPreference = 'Stop'
$vpnRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$vpnResultPath = Join-Path $vpnRoot '.contingency/backend/vpn-disable-result.json'
try {
  $vpnAdapter = Get-NetAdapter -Name 'McAfee_VPN' -ErrorAction Stop
  if ($vpnAdapter.InterfaceGuid -ne '{A230D696-EA94-4D58-A2D0-3BCA64A9B8AE}' -or $vpnAdapter.InterfaceDescription -ne 'WireGuard Tunnel') {
    throw 'VPN adapter identity changed; no action taken'
  }
  $vpnAdapter | Disable-NetAdapter -Confirm:$false -ErrorAction Stop
  Clear-DnsClientCache
  $vpnAfter = Get-NetAdapter -Name 'McAfee_VPN' -ErrorAction Stop
  @{ok=($vpnAfter.Status -eq 'Disabled');name=$vpnAfter.Name;status=[string]$vpnAfter.Status;at=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $vpnResultPath
} catch {
  @{ok=$false;error=$_.Exception.Message;at=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $vpnResultPath
  exit 1
}
