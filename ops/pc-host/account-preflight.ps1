param(
  [Parameter(Mandatory=$true)][string]$NodePath,
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [Parameter(Mandatory=$true)][string]$RuntimeAccount,
  [Parameter(Mandatory=$true)][string]$DevelopmentAccount,
  [Parameter(Mandatory=$true)][string]$PowerShellPath,
  [switch]$PassThru
)
$ErrorActionPreference='Stop'
# Task checks use only modules shipped with the selected interpreter/Windows.
$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')+[IO.Path]::PathSeparator+[IO.Path]::Combine([Environment]::SystemDirectory,'WindowsPowerShell/v1.0/Modules')
$systemSid='S-1-5-18'
$administratorsSid='S-1-5-32-544'
$installerSid='S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$trustedSids=@($systemSid,$administratorsSid,$installerSid)
$writeMask=[int64][Security.AccessControl.FileSystemRights]::Write -bor [int64][Security.AccessControl.FileSystemRights]::Delete -bor [int64][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [int64][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int64][Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x40000000 -bor 0x10000000
$replaceMask=[int64][Security.AccessControl.FileSystemRights]::Delete -bor [int64][Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [int64][Security.AccessControl.FileSystemRights]::ChangePermissions -bor [int64][Security.AccessControl.FileSystemRights]::TakeOwnership -bor 0x10000000

function Resolve-Sid([string]$Account){
  return ([Security.Principal.NTAccount]::new($Account)).Translate([Security.Principal.SecurityIdentifier]).Value
}
function Assert-Access([string]$Path,[string[]]$WriteSids,[string[]]$OwnerSids,[int64]$Mask,[bool]$Protected=$false){
  $item=Get-Item -LiteralPath $Path -Force
  if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected deployment path rejected'}
  $acl=Get-Acl -LiteralPath $Path
  $owner=Resolve-Sid $acl.Owner
  if($owner -notin $OwnerSids){throw 'Deployment owner is outside the intended account boundary'}
  if($Protected -and !$acl.AreAccessRulesProtected){throw 'Deployment boundary inherits permissions'}
  foreach($rule in $acl.Access){
    $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if($rule.AccessControlType -eq 'Allow' -and ([int64]$rule.FileSystemRights -band $Mask) -and $sid -notin $WriteSids){throw 'Deployment path is writable outside its intended boundary'}
  }
}
function Assert-Parents([string]$Path,[string[]]$AllowedSids=$trustedSids){
  $parent=Split-Path -Path $Path -Parent
  while($parent){
    Assert-Access $parent $AllowedSids $AllowedSids $replaceMask
    $next=Split-Path -Path $parent -Parent
    if($next -eq $parent){break}
    $parent=$next
  }
}
function Assert-Private([string]$Path,[bool]$Directory,[bool]$Protected=$true){
  Assert-Access $Path @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask $Protected
  $item=Get-Item -LiteralPath $Path -Force
  if($item.PSIsContainer -ne $Directory){throw 'Unexpected deployment path kind'}
  $acl=Get-Acl -LiteralPath $Path
  if($acl.Access.Count -ne 2){throw 'Private deployment path requires only runtime and SYSTEM entries'}
  $allowed=@($acl.Access | ForEach-Object {$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value})
  if($runtimeSid -notin $allowed -or $systemSid -notin $allowed -or @($acl.Access | Where-Object {$_.AccessControlType -ne 'Allow'}).Count){throw 'Private deployment principals mismatch'}
  $full=[int64][Security.AccessControl.FileSystemRights]::FullControl
  if(@($acl.Access | Where-Object {([int64]$_.FileSystemRights -band $full) -ne $full}).Count){throw 'Private deployment principals require full access'}
}
function Assert-ExecutableTree([string]$Path){
  $directory=Split-Path -Path $Path -Parent
  Assert-Access $directory $trustedSids $trustedSids $writeMask
  foreach($item in Get-ChildItem -LiteralPath $directory -Recurse -Force){Assert-Access $item.FullName $trustedSids $trustedSids $writeMask}
  Assert-Parents $Path
}

# Read-only acceptance check: no account, ACL, task or service is created/changed.
try{
  if(!$IsWindows -or $PSVersionTable.PSVersion.Major -lt 7){throw 'Windows PowerShell 7 required'}
  foreach($path in @($NodePath,$ConfigPath,$PowerShellPath)){if(![IO.Path]::IsPathFullyQualified($path)){throw 'Absolute deployment paths required'}}
  $runtimeSid=Resolve-Sid $RuntimeAccount
  $developmentSid=Resolve-Sid $DevelopmentAccount
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if($runtimeSid -eq $developmentSid -or $runtimeSid -in $trustedSids){throw 'A separate non-administrator runtime account is required'}
  if($identity.User.Value -ne $runtimeSid){throw 'Run this check as the intended runtime account'}
  if($administratorsSid -in @($identity.Groups | ForEach-Object {$_.Value})){throw 'Runtime account must not belong to administrators'}
  $actualShell=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  if(![string]::Equals([IO.Path]::GetFullPath($actualShell),[IO.Path]::GetFullPath($PowerShellPath),[StringComparison]::OrdinalIgnoreCase)){throw 'Selected PowerShell executable must be the current interpreter'}
  $expectedProgramFiles=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  $expectedWindows=[Environment]::GetFolderPath([Environment+SpecialFolder]::Windows)
  if(![string]::Equals([IO.Path]::GetFullPath($env:ProgramFiles),[IO.Path]::GetFullPath($expectedProgramFiles),[StringComparison]::OrdinalIgnoreCase) -or ![string]::Equals([IO.Path]::GetFullPath($env:SystemRoot),[IO.Path]::GetFullPath($expectedWindows),[StringComparison]::OrdinalIgnoreCase)){throw 'System tool roots must match Windows known folders'}
  $expectedShell=[IO.Path]::Combine($expectedProgramFiles,'PowerShell/7/pwsh.exe')
  if(![string]::Equals([IO.Path]::GetFullPath($PowerShellPath),[IO.Path]::GetFullPath($expectedShell),[StringComparison]::OrdinalIgnoreCase)){throw 'Use the protected PowerShell 7 installation'}
  foreach($path in @($NodePath,$PowerShellPath)){
    Assert-Access $path $trustedSids $trustedSids $writeMask
    Assert-ExecutableTree $path
    if((Get-Item -LiteralPath $path).PSIsContainer){throw 'Executable file required'}
    $null=[IO.File]::OpenRead($path).Dispose()
  }
  $gitRoot=[IO.Path]::Combine($env:ProgramFiles,'Git')
  $gitExecutable=[IO.Path]::Combine($gitRoot,'cmd/git.exe')
  Assert-Access $gitRoot $trustedSids $trustedSids $writeMask
  foreach($item in Get-ChildItem -LiteralPath $gitRoot -Recurse -Force){Assert-Access $item.FullName $trustedSids $trustedSids $writeMask}
  Assert-Parents $gitExecutable
  $null=[IO.File]::OpenRead($gitExecutable).Dispose()
  foreach($tool in @('whoami.exe','icacls.exe')){
    $toolPath=[IO.Path]::Combine([Environment]::SystemDirectory,$tool)
    Assert-Access $toolPath $trustedSids $trustedSids $writeMask
    Assert-Parents $toolPath
    $null=[IO.File]::OpenRead($toolPath).Dispose()
  }
  Assert-Private (Split-Path -Path $ConfigPath -Parent) $true
  Assert-Parents (Split-Path -Path $ConfigPath -Parent) (@($runtimeSid)+$trustedSids)
  Assert-Private $ConfigPath $false $false
  $config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  foreach($path in @($config.releaseDirectory,$config.environmentFile,$config.stateDirectory)){if(![IO.Path]::IsPathFullyQualified($path)){throw 'Absolute configuration paths required'}}
  $expectedHelpers=[IO.Path]::GetFullPath((Join-Path $config.releaseDirectory 'ops/pc-host'))
  if(![string]::Equals([IO.Path]::GetFullPath($PSScriptRoot),$expectedHelpers,[StringComparison]::OrdinalIgnoreCase)){throw 'Host helper scripts must belong to the verified release'}
  Assert-Private (Split-Path -Path $config.environmentFile -Parent) $true
  Assert-Parents (Split-Path -Path $config.environmentFile -Parent) (@($runtimeSid)+$trustedSids)
  Assert-Private $config.environmentFile $false $false
  $null=[IO.File]::OpenRead($config.environmentFile).Dispose()
  Assert-Private $config.stateDirectory $true
  Assert-Parents $config.stateDirectory (@($runtimeSid)+$trustedSids)
  foreach($item in Get-ChildItem -LiteralPath $config.stateDirectory -Recurse -Force){
    Assert-Private $item.FullName ([bool]$item.PSIsContainer) $false
  }
  Assert-Access $config.releaseDirectory $trustedSids $trustedSids $writeMask $true
  Assert-Parents $config.releaseDirectory
  $releaseRoot=[IO.Path]::GetFullPath($config.releaseDirectory).TrimEnd('\')
  $mutable=@('.next/cache','.next/trace','.next/trace-build','.next/diagnostics')
  foreach($item in Get-ChildItem -LiteralPath $releaseRoot -Recurse -Force){
    $relative=[IO.Path]::GetRelativePath($releaseRoot,$item.FullName).Replace('\','/')
    $isMutable=@($mutable | Where-Object {$relative -eq $_ -or $relative.StartsWith($_+'/',[StringComparison]::Ordinal)}).Count -gt 0
    if($isMutable){Assert-Access $item.FullName @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask}
    else{Assert-Access $item.FullName $trustedSids $trustedSids $writeMask}
  }
  $result=[pscustomobject]@{version=1;accepted=$true;runtimeSid=$runtimeSid;developmentSid=$developmentSid;releaseCommit=$config.releaseCommit;releaseId=$config.releaseId;powerShellSha256=(Get-FileHash -LiteralPath $PowerShellPath -Algorithm SHA256).Hash.ToLowerInvariant();checkedAt=[DateTime]::UtcNow.ToString('O')}
  if($PassThru){return $result}
  $result | ConvertTo-Json -Compress
}catch{
  if($PassThru){throw}
  [pscustomobject]@{version=1;accepted=$false;reason=$_.Exception.Message} | ConvertTo-Json -Compress
  exit 1
}
