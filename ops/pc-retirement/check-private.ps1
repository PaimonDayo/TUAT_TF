param([Parameter(Mandatory)][string]$Directory,[string]$FileNames='')
$ErrorActionPreference='Stop'
$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$system='S-1-5-18'
$privatePrincipals=@($current,$system | Select-Object -Unique)
$trusted=@($current,$system,'S-1-5-32-544',([Security.Principal.NTAccount]::new('NT SERVICE\TrustedInstaller')).Translate([Security.Principal.SecurityIdentifier]).Value)
function CheckPrivate([string]$Path,[bool]$IsDirectory) {
  $item=Get-Item -LiteralPath $Path -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.PSIsContainer -ne $IsDirectory){throw 'Private snapshot path invalid'}
  $acl=Get-Acl -LiteralPath $Path
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $privatePrincipals){throw 'Private snapshot owner invalid'}
  if($IsDirectory -and !$acl.AreAccessRulesProtected){throw 'Private snapshot ACL must be protected'}
  $seen=[Collections.Generic.HashSet[string]]::new()
  foreach($rule in $acl.Access){
    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if($sid -notin $privatePrincipals -or $rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){throw 'Private snapshot readers/writers invalid'}
    [void]$seen.Add($sid)
  }
  if($seen.Count -ne $privatePrincipals.Count){throw 'Private snapshot principals incomplete'}
}
CheckPrivate $Directory $true
foreach($name in ($FileNames -split ',' | Where-Object {$_})){
  if($name -notmatch '^[a-f0-9-]{36}\.(snapshot|dry-run)\.enc$'){throw 'Private snapshot filename invalid'}
  CheckPrivate (Join-Path $Directory $name) $false
}
$parent=[IO.DirectoryInfo]::new($Directory).Parent
while($null -ne $parent){
  $item=Get-Item -LiteralPath $parent.FullName -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Private snapshot parent redirect invalid'}
  $acl=Get-Acl -LiteralPath $parent.FullName
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted){throw 'Private snapshot parent owner invalid'}
  foreach($rule in $acl.Access){
    if($rule.AccessControlType -ne 'Allow' -or ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0){continue}
    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    $mask=([int64]$rule.FileSystemRights.value__) -band 0xffffffffL
    # Delete/DeleteChild/ChangePermissions/TakeOwnership/GenericAll allow replacement.
    if($sid -notin $trusted -and ($mask -band 0x100d0040L) -ne 0){throw 'Private snapshot parent replacement invalid'}
  }
  $parent=$parent.Parent
}
