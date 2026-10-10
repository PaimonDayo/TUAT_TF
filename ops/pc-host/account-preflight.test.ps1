$ErrorActionPreference='Stop'
$tokens=$null
$parseErrors=$null
foreach($name in @('account-preflight.ps1','stage-task.ps1','task.ps1')){
  $null=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot $name),[ref]$tokens,[ref]$parseErrors)
  if($parseErrors.Count){throw 'Host script has a syntax error'}
}
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'account-preflight.ps1'),[ref]$tokens,[ref]$parseErrors)
foreach($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)){Invoke-Expression $function.Extent.Text}
$runtimeSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$systemSid='S-1-5-18'
$maskAssignments=$ast.FindAll({param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -in @('$writeMask','$replaceMask')},$false)
if($maskAssignments.Count -ne 2){throw 'Host permission policy masks not found'}
foreach($assignment in $maskAssignments){Invoke-Expression $assignment.Extent.Text}
$fixtureParent=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.contingency')).TrimEnd('\')
$fixture=[IO.Path]::GetFullPath((Join-Path $fixtureParent ('account-acl-review-'+[Guid]::NewGuid().ToString('N'))))
if(!$fixture.StartsWith($fixtureParent+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Test fixture escaped its workspace'}
$null=New-Item -ItemType Directory -Path $fixture
try{
  & icacls $fixture /inheritance:r /grant:r ('*'+$runtimeSid+':(OI)(CI)(F)') '*S-1-5-18:(OI)(CI)(F)' | Out-Null
  if($LASTEXITCODE){throw 'Fixture ACL setup failed'}
  Assert-Private $fixture $true
  $file=Join-Path $fixture 'sample.env'
  [IO.File]::WriteAllText($file,'SYNTHETIC_ONLY=true')
  Assert-Private $file $false $false
  & icacls $file /grant '*S-1-1-0:(R)' | Out-Null
  if($LASTEXITCODE){throw 'Fixture read permission setup failed'}
  $rejected=$false
  try{Assert-Private $file $false $false}catch{$rejected=$true}
  if(!$rejected){throw 'Private secret path allowed an extra reader'}
  & icacls $file /remove:g '*S-1-1-0' | Out-Null
  & icacls $file /grant '*S-1-1-0:(M)' | Out-Null
  if($LASTEXITCODE){throw 'Fixture write permission setup failed'}
  $rejected=$false
  try{Assert-Access $file @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask}catch{$rejected=$true}
  if(!$rejected){throw 'Runtime path allowed an extra writer'}
  # Generic masks can be present in raw SDDL even when not named by the enum.
  # Parse those descriptors without changing any real ACL.
  foreach($generic in @('GW','GA')){
    $descriptor=[Security.AccessControl.FileSecurity]::new()
    $descriptor.SetSecurityDescriptorSddlForm('O:'+$runtimeSid+'G:'+$runtimeSid+'D:P(A;;FA;;;'+$runtimeSid+')(A;;FA;;;SY)(A;;'+$generic+';;;WD)')
    $script:rawSddlAcl=[pscustomobject]@{Owner=$descriptor.GetOwner([Security.Principal.NTAccount]).Value;AreAccessRulesProtected=$true;Access=$descriptor.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])}
    function Get-Acl {param([string]$LiteralPath) return $script:rawSddlAcl}
    $rejected=$false
    try{Assert-Access $file @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask}catch{$rejected=$true}
    if(!$rejected){throw 'Generic extra writer was not rejected'}
    Remove-Item -LiteralPath Function:Get-Acl
  }
  Write-Output 'PowerShell parse and real temporary ACL refusal checks passed.'
}finally{
  $resolvedFixture=[IO.Path]::GetFullPath($fixture)
  if(!$resolvedFixture.StartsWith($fixtureParent+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup escaped test fixture boundary'}
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
