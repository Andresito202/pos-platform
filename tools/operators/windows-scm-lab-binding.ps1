# Shared lab precondition only. No service, filesystem or trust mutation.
function Test-WindowsScmLabImagePath([string]$ImagePath,[string]$ExpectedExecutable){
 if([string]::IsNullOrWhiteSpace($ImagePath) -or [string]::IsNullOrWhiteSpace($ExpectedExecutable)){return $false}
 if($ExpectedExecutable -notmatch '^[a-z]:\\' -or [IO.Path]::GetFullPath($ExpectedExecutable) -ine $ExpectedExecutable){return $false}
 $actual=$ImagePath.Trim()
 # Never accept a substring match, extra arguments, environment expansion or
 # an unquoted executable containing spaces (Windows service path ambiguity).
 if($actual.Equals(('"'+$ExpectedExecutable+'"'),[StringComparison]::OrdinalIgnoreCase)){return $true}
 return $ExpectedExecutable -notmatch '\s' -and $actual.Equals($ExpectedExecutable,[StringComparison]::OrdinalIgnoreCase)
}
