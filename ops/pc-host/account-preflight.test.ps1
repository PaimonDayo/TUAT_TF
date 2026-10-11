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
  # A protected OS installation can have CREATOR OWNER inheritance templates.
  # Inspect its current object read-only; do not modify Program Files permissions.
  $trustedSids=@($systemSid,'S-1-5-32-544','S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
  Assert-Access $PSHOME $trustedSids $trustedSids $writeMask
  $ownerTemplate=Join-Path $fixture 'creator-owner-template'
  $null=New-Item -ItemType Directory -Path $ownerTemplate
  & icacls $ownerTemplate /grant '*S-1-3-0:(OI)(CI)(IO)(F)' | Out-Null
  if($LASTEXITCODE){throw 'Creator-owner inheritance fixture setup failed'}
  Assert-Access $ownerTemplate @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask
  $ownerChild=Join-Path $ownerTemplate 'owned-child.txt'
  [IO.File]::WriteAllText($ownerChild,'SYNTHETIC_ONLY=true')
  Assert-Access $ownerChild @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask
  # Private paths still require exactly the two explicit allowed principals.
  $rejected=$false
  try{Assert-Private $ownerTemplate $true $false}catch{$rejected=$true}
  if(!$rejected){throw 'Private boundary accepted an extra inheritance template'}
  $everyoneTemplate=Join-Path $fixture 'everyone-template'
  $null=New-Item -ItemType Directory -Path $everyoneTemplate
  & icacls $everyoneTemplate /grant '*S-1-1-0:(OI)(CI)(IO)(M)' | Out-Null
  if($LASTEXITCODE){throw 'Everyone inheritance fixture setup failed'}
  Assert-Access $everyoneTemplate @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask
  $everyoneChild=Join-Path $everyoneTemplate 'effective-child.txt'
  [IO.File]::WriteAllText($everyoneChild,'SYNTHETIC_ONLY=true')
  $rejected=$false
  try{Assert-Access $everyoneChild @($runtimeSid,$systemSid) @($runtimeSid,$systemSid) $writeMask}catch{$rejected=$true}
  if(!$rejected){throw 'Child accepted an effective inherited Everyone writer'}
  # Pure synthetic metadata fixtures: no Git command or external path is read.
  $gitFixture=Join-Path $fixture 'standalone-release'
  $gitMetadata=Join-Path $gitFixture '.git'
  $null=New-Item -ItemType Directory -Path $gitMetadata
  $gitConfig=Join-Path $gitMetadata 'config'
  $ordinaryConfig="[core]`nrepositoryformatversion = 0`nbare = false`nfilemode = false`nautocrlf = true`n[remote `"origin`"]`nurl = https://example.test/fixture.git`nfetch = +refs/heads/*:refs/remotes/origin/*`n[branch `"master`"]`nremote = origin`nmerge = refs/heads/master`n"
  $originalGitEnvironment=@{}
  foreach($entry in Get-ChildItem Env: | Where-Object {$_.Name -like 'GIT_*'}){$originalGitEnvironment[$entry.Name]=$entry.Value;Remove-Item -LiteralPath ('Env:'+$entry.Name)}
  try{
    [IO.File]::WriteAllText($gitConfig,$ordinaryConfig)
    Assert-StandaloneGit $gitFixture
    foreach($marker in @('commondir','objects/info/alternates','objects/info/http-alternates','config.worktree','worktrees')){
      $markerPath=Join-Path $gitMetadata $marker
      $null=New-Item -ItemType Directory -Path (Split-Path -Path $markerPath -Parent) -Force
      if($marker -eq 'worktrees'){$null=New-Item -ItemType Directory -Path $markerPath}
      else{[IO.File]::WriteAllText($markerPath,'SYNTHETIC_EXTERNAL_REFERENCE')}
      $rejected=$false
      try{Assert-StandaloneGit $gitFixture}catch{$rejected=$true}
      if(!$rejected){throw 'Shared Git metadata marker was accepted'}
      Remove-Item -LiteralPath $markerPath -Recurse -Force
    }
    foreach($unsafe in @(
      "[include]`npath = ../outside.gitconfig`n",
      "[includeIf `"gitdir:../`"]`npath = ../outside.gitconfig`n",
      "[core]`nworktree = ../outside`n",
      "[core]`nfsmonitor = helper`n",
      "[core]`nhooksPath = ../hooks`n",
      "[core]`nattributesFile = ../attributes`n",
      "[core]`nsshCommand = helper`n",
      "[filter `"fixture`"]`nclean = helper`n",
      "[extensions]`nworktreeConfig = true`n",
      "[core]`nbare = true`n",
      "[core]`nrepositoryformatversion = 1`n",
      "[core]`nautocrlf = true\`nfalse`n"
    )){
      [IO.File]::WriteAllText($gitConfig,$unsafe)
      $rejected=$false
      try{Assert-StandaloneGit $gitFixture}catch{$rejected=$true}
      if(!$rejected){throw 'External or unreviewed Git configuration was accepted'}
    }
    [IO.File]::WriteAllText($gitConfig,('x'*65537))
    $rejected=$false
    try{Assert-StandaloneGit $gitFixture}catch{$rejected=$true}
    if(!$rejected){throw 'Unbounded Git configuration was accepted'}
    [IO.File]::WriteAllBytes($gitConfig,[byte[]]@(0xc3,0x28))
    $rejected=$false
    try{Assert-StandaloneGit $gitFixture}catch{$rejected=$true}
    if(!$rejected){throw 'Invalid UTF-8 Git configuration was accepted'}
    [IO.File]::WriteAllText($gitConfig,$ordinaryConfig)
    foreach($name in @('GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_CONFIG_COUNT','GIT_CONFIG_GLOBAL','GIT_CONFIG_SYSTEM','GIT_EXTERNAL_DIFF')){
      Set-Item -LiteralPath ('Env:'+$name) -Value 'SYNTHETIC_OVERRIDE'
      $rejected=$false
      try{Assert-StandaloneGit $gitFixture}catch{$rejected=$true}
      Remove-Item -LiteralPath ('Env:'+$name)
      if(!$rejected){throw 'Inherited Git override was accepted'}
    }
    # A worktree pointer is refused before its reference can be followed.
    $linkedFixture=Join-Path $fixture 'linked-release'
    $null=New-Item -ItemType Directory -Path $linkedFixture
    [IO.File]::WriteAllText((Join-Path $linkedFixture '.git'),'gitdir: SYNTHETIC_DO_NOT_FOLLOW')
    $rejected=$false
    try{Assert-StandaloneGit $linkedFixture}catch{$rejected=$true}
    if(!$rejected){throw 'Linked Git worktree metadata was accepted'}
    $redirectedFixture=Join-Path $fixture 'redirected-release'
    $null=New-Item -ItemType Directory -Path $redirectedFixture
    $null=New-Item -ItemType Junction -Path (Join-Path $redirectedFixture '.git') -Target $gitMetadata
    $rejected=$false
    try{Assert-StandaloneGit $redirectedFixture}catch{$rejected=$true}
    if(!$rejected){throw 'Redirected Git metadata directory was accepted'}
    Assert-StandaloneGit $gitFixture
  }finally{
    foreach($entry in Get-ChildItem Env: | Where-Object {$_.Name -like 'GIT_*'}){Remove-Item -LiteralPath ('Env:'+$entry.Name)}
    foreach($name in $originalGitEnvironment.Keys){Set-Item -LiteralPath ('Env:'+$name) -Value $originalGitEnvironment[$name]}
  }
  Write-Output 'PowerShell parse, inheritance templates, standalone Git metadata and real temporary ACL refusal checks passed.'
}finally{
  $resolvedFixture=[IO.Path]::GetFullPath($fixture)
  if(!$resolvedFixture.StartsWith($fixtureParent+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Cleanup escaped test fixture boundary'}
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
