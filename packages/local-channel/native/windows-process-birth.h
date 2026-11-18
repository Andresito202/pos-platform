#pragma once
#include <winternl.h>
#include <cstddef>
#include <cstring>

// Read-only kernel process inventory. No cross-user process/token handles.
// Validate the NT layout against this process's documented GetProcessTimes
// before trusting a peer birth time; unsupported layouts fail closed.
// https://learn.microsoft.com/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation
static uint64_t kernelProcessBirth(DWORD wanted){
 struct Row{
  ULONG next,threads;unsigned char reserved[24];
  LARGE_INTEGER born,user,kernel;UNICODE_STRING image;LONG priority;HANDLE pid;
 };
 static_assert(sizeof(void*)==8&&offsetof(Row,born)==32&&offsetof(Row,pid)==80,"Windows x64 process layout required");
 auto deny=[](){throw std::runtime_error("WINDOWS_NATIVE_PIPE_REJECTED");};
 using Query=LONG(NTAPI*)(ULONG,PVOID,ULONG,PULONG);
 auto query=reinterpret_cast<Query>(GetProcAddress(GetModuleHandleW(L"ntdll.dll"),"NtQuerySystemInformation"));
 if(!query)deny();
 std::vector<unsigned char> bytes(65536);ULONG used=0;LONG status=0;
 for(unsigned attempt=0;;attempt++){
  status=query(5,bytes.data(),static_cast<ULONG>(bytes.size()),&used);
  if(status>=0)break;
  if(status!=static_cast<LONG>(0xc0000004L)||attempt>=8||used>32*1024*1024)deny();
  const size_t size=(used>bytes.size()?used:bytes.size()*2)+4096;
  if(size>32*1024*1024)deny();bytes.resize(size);
 }
 if(used>bytes.size()||used<sizeof(Row))deny();
 uint64_t own=0,peer=0;unsigned ownCount=0,peerCount=0;
 size_t offset=0;
 for(;;){
  if(offset>used||used-offset<sizeof(Row))deny();
  Row row{};std::memcpy(&row,bytes.data()+offset,sizeof(row));
  const auto pid=reinterpret_cast<uintptr_t>(row.pid);
  if(pid==GetCurrentProcessId()){own=static_cast<uint64_t>(row.born.QuadPart);ownCount++;}
  if(pid==wanted){peer=static_cast<uint64_t>(row.born.QuadPart);peerCount++;}
  if(row.next==0)break;
  if(row.next<sizeof(Row)||row.next>used-offset)deny();offset+=row.next;
 }
 FILETIME c,x,k,u;
 if(!GetProcessTimes(GetCurrentProcess(),&c,&x,&k,&u))deny();
 const uint64_t expected=(uint64_t(c.dwHighDateTime)<<32)|c.dwLowDateTime;
 if(ownCount!=1||peerCount!=1||own!=expected||peer==0)deny();
 return peer;
}
