// Existing owner S4U task. Secrets stay in child-process pipes, never argv/logs.
import {readFileSync,writeFileSync,appendFileSync,lstatSync,realpathSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const need=value=>{if(!value)throw Error('boot-held');};
const sha=value=>createHash('sha256').update(value).digest('hex');
const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
const wsl='C:/Windows/System32/wsl.exe';
export const privateAccessScript=`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$bootPaths=ConvertFrom-Json ([Console]::In.ReadToEnd())
$bootOwner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$bootAllowed=@($bootOwner,'S-1-5-18')
function Test-BootPrivate([string]$Path,[bool]$Directory) {
 try {
  $item=Get-Item -LiteralPath $Path -Force
  if($item.PSIsContainer -ne $Directory -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){return $false}
  $acl=Get-Acl -LiteralPath $Path
  if(!$acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $bootAllowed -or !$acl.Access.Count){return $false}
  $granted=@()
  foreach($rule in $acl.Access){
   if($rule.AccessControlType -ne 'Allow'){continue}
   $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
   if($sid -notin $bootAllowed){return $false}
   $granted+=$sid
  }
  return ($bootOwner -in $granted -and 'S-1-5-18' -in $granted)
 } catch {return $false}
}
$bootRootValid=Test-BootPrivate $bootPaths.root $true
$bootFilesValid=$bootRootValid
if($bootRootValid){foreach($path in $bootPaths.files){if(!(Test-BootPrivate $path $false)){$bootFilesValid=$false}}}
[Console]::Out.Write((@{rootValid=$bootRootValid;filesValid=$bootFilesValid}|ConvertTo-Json -Compress))
`;
export function sendKey(child,value){
 child.stdin.on('error',()=>{value.fill(0);});
 child.stdin.end(value,()=>{value.fill(0);});
}
let key,stage='configuration',outputDirectory;
const privateRead=(file,maximum=65536)=>{
 const info=lstatSync(file);need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size<=maximum&&realpathSync(file).toLowerCase()===resolve(file).toLowerCase());
 return readFileSync(file);
};
const current=value=>writeFileSync(resolve(outputDirectory,'boot-current-result.json'),JSON.stringify({checkedAt:new Date().toISOString(),...value})+'\n',{mode:0o600});
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase()){
try {
 need(process.platform==='win32'&&process.argv.length===3);
 const file=resolve(process.argv[2]),loader=resolve(process.argv[1]),privateRoot=dirname(file),machineBlob=resolve(privateRoot,'luks-key.machine.dpapi');
 need(dirname(loader).toLowerCase()===privateRoot.toLowerCase());
 const root=lstatSync(privateRoot);
 need(root.isDirectory()&&!root.isSymbolicLink()&&realpathSync(privateRoot).toLowerCase()===privateRoot.toLowerCase());
 const options={encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:16384,stdio:['pipe','pipe','pipe']};
 stage='private-access';
 const access=JSON.parse(execFileSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(privateAccessScript,'utf16le').toString('base64')],{...options,env:{...process.env,PSModulePath:'C:/Windows/System32/WindowsPowerShell/v1.0/Modules'},input:JSON.stringify({root:privateRoot,files:[file,machineBlob,loader]})}));
 if(access.rootValid===true)outputDirectory=privateRoot;
 if(outputDirectory)current({valid:false,phase:'starting',stage});
 need(access.rootValid===true&&access.filesValid===true);
 stage='configuration';
 const bytes=privateRead(file),config=JSON.parse(bytes);
 need(config.version===1&&config.enabled===true&&config.distribution==='Ubuntu'&&/^[a-f0-9]{64}$/.test(config.keyFingerprint??'')&&/^[a-f0-9]{64}$/.test(config.linuxScriptSha256??''));
 need(config.linuxScript==='/opt/tuat-local-runtime/pc-bootstrap.py');
 need(resolve(config.machineBlob)===machineBlob);
 stage='installed-loader';
 const installed=execFileSync(wsl,['-d',config.distribution,'-u','root','--','sha256sum',config.linuxScript],options).trim().split(/\s+/);
 need(installed.length===2&&installed[0]===config.linuxScriptSha256&&installed[1]===config.linuxScript);
 stage='machine-key';
 const script='Add-Type -AssemblyName System.Security; $bootBlob=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $bootKey=[Security.Cryptography.ProtectedData]::Unprotect($bootBlob,$null,[Security.Cryptography.DataProtectionScope]::LocalMachine); try {[Console]::Out.Write([Convert]::ToBase64String($bootKey))} finally {[Array]::Clear($bootKey,0,$bootKey.Length)}';
 key=Buffer.from(execFileSync(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{...options,env:{...process.env,PSModulePath:'C:/Windows/System32/WindowsPowerShell/v1.0/Modules'},input:privateRead(config.machineBlob,16384).toString('base64')}).trim(),'base64');
 need(key.length===32&&sha(key)===config.keyFingerprint&&privateRead(file).equals(bytes));
 stage='start-and-observe';
 const child=spawn(wsl,['-d',config.distribution,'-u','root','--','python3','-I','-B',config.linuxScript,'--start','--watch'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',errors=0,accepted=false;
 const completion=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});
 child.stdout.on('data',chunk=>{
  output+=chunk.toString('utf8');
  if(output.length>16384){child.stdout.destroy();return;}
  if(!accepted&&output.includes('\n')){
   try {const value=JSON.parse(output.split('\n')[0]);if(value.valid===true&&value.runtimeStarted===true){
    const evidence={valid:true,checkedAt:new Date().toISOString(),storageOpened:value.opened,storageMounted:value.mounted,runtimeStarted:true,osRebootTested:false};
    writeFileSync(resolve(outputDirectory,'boot-startup-result.json'),JSON.stringify(evidence)+'\n',{mode:0o600});
    current({...evidence,phase:'watching'});accepted=true;
   }}
   catch{/* An invalid child result never becomes a successful start. */}
  }
 });
 child.stderr.on('data',chunk=>{errors+=chunk.length;});
 sendKey(child,key);
 const result=await completion;
 need(accepted&&result.code===0&&!result.signal&&errors===0);
}catch {
 if(outputDirectory){
  current({valid:false,phase:'held',stage,automaticRetry:false});
  appendFileSync(resolve(outputDirectory,'boot-held.jsonl'),JSON.stringify({held:true,stage,checkedAt:new Date().toISOString(),automaticRetry:false})+'\n',{mode:0o600});
 }
 process.exitCode=1;
}finally {key?.fill(0);}
}
