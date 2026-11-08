import {spawnSync} from "node:child_process";
/** Adapter for the existing custody profile; private pipe output is captured,
 * never forwarded to a console. CurrentUser requires the service identity. */
export function readWindowsFactusPayCredential(path:string,ciphertext:string):unknown{
  if(process.platform!=="win32")throw Error("FACTUS_PAY_WINDOWS_CUSTODY_REQUIRED");
  const script=String.raw`
$ErrorActionPreference='Stop'
try {
  Add-Type -AssemblyName System.Security
  $p=[Console]::In.ReadToEnd()|ConvertFrom-Json
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach($name in @($p.path,[IO.Path]::GetDirectoryName($p.path))){
    $item=Get-Item -LiteralPath $name -Force
    if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'REPARSE'}
    $acl=Get-Acl -LiteralPath $name
    if(-not $acl.AreAccessRulesProtected -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'OWNER'}
    foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){
      if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin @($sid,'S-1-5-18')){throw 'ACL'}
    }
  }
  $data=[Convert]::FromBase64String($p.ciphertext)
  $entropy=[Text.Encoding]::UTF8.GetBytes('CAMACHO_FACTUS_PAY_API_CUSTODY_V1')
  $plain=[Security.Cryptography.ProtectedData]::Unprotect($data,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  try{[Console]::Out.Write([Convert]::ToBase64String($plain))}finally{[Array]::Clear($plain,0,$plain.Length)}
}catch{[Console]::Error.Write('CUSTODY_REJECTED');exit 1}
`;
  const input=Buffer.from(JSON.stringify({path,ciphertext}));
  const result=spawnSync("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-Command",script],{input,windowsHide:true,timeout:15000,maxBuffer:131072});input.fill(0);
  try{if(result.error||result.status!==0)throw Error("FACTUS_PAY_WINDOWS_CUSTODY_REJECTED");
    const plain=Buffer.from(result.stdout.toString("ascii"),"base64");try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(plain));}finally{plain.fill(0);}
  }finally{result.stdout?.fill(0);result.stderr?.fill(0);}
}
