// Node-API transport adapter. Owns the actual pipe handles before net.Socket
// adopts their CRT descriptor. Never inspects a second connection by name.
#include <node_api.h>
#include <string>
#include <stdexcept>
#include <memory>
#include <mutex>
#include <vector>
#include <cstdint>
#ifdef _WIN32
#include <windows.h>
#include <uv.h>
#include <sddl.h>
#include <tlhelp32.h>
#include <io.h>
#include <fcntl.h>
#endif

static void check(napi_status s){if(s!=napi_ok)throw std::runtime_error("NATIVE_PIPE_API_FAILED");}
static napi_value reject(napi_env e){napi_throw_error(e,nullptr,"WINDOWS_NATIVE_PIPE_REJECTED");return nullptr;}
#ifdef _WIN32
struct Handle{HANDLE h=INVALID_HANDLE_VALUE;Handle()=default;explicit Handle(HANDLE v):h(v){}~Handle(){if(h&&h!=INVALID_HANDLE_VALUE)CloseHandle(h);}Handle(const Handle&)=delete;};
static void require(bool v){if(!v)throw std::runtime_error("WINDOWS_NATIVE_PIPE_REJECTED");}
static std::wstring str(napi_env e,napi_value v){size_t n=0;check(napi_get_value_string_utf16(e,v,nullptr,0,&n));require(n>0&&n<=2048);std::vector<char16_t>b(n+1);check(napi_get_value_string_utf16(e,v,b.data(),b.size(),&n));return std::wstring(reinterpret_cast<wchar_t*>(b.data()),n);}
static uint32_t num(napi_env e,napi_value v){double n;check(napi_get_value_double(e,v,&n));require(n>=0&&n<=0x7fffffff&&n==static_cast<uint32_t>(n));return static_cast<uint32_t>(n);}
static std::wstring sidText(PSID sid){LPWSTR text=nullptr;require(IsValidSid(sid)&&ConvertSidToStringSidW(sid,&text));std::wstring s(text);LocalFree(text);return s;}
static void sidValid(const std::wstring& s){PSID sid=nullptr;require(ConvertStringSidToSidW(s.c_str(),&sid));std::wstring canonical=sidText(sid);LocalFree(sid);require(canonical==s);}
static uint64_t creation(HANDLE h){FILETIME c,x,k,u;require(GetProcessTimes(h,&c,&x,&k,&u));return (uint64_t(c.dwHighDateTime)<<32)|c.dwLowDateTime;}
struct Identity{std::wstring sid,logon;DWORD session=0,pid=0;uint64_t born=0;};
static Identity identity(DWORD pid){
 Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE,FALSE,pid));require(process.h&&process.h!=INVALID_HANDLE_VALUE);
 require(WaitForSingleObject(process.h,0)==WAIT_TIMEOUT); // must still be alive
 Handle token;require(OpenProcessToken(process.h,TOKEN_QUERY,&token.h));
 auto info=[&](TOKEN_INFORMATION_CLASS cls){DWORD n=0;GetTokenInformation(token.h,cls,nullptr,0,&n);require(n>0&&n<1048576);std::vector<unsigned char>b(n);require(GetTokenInformation(token.h,cls,b.data(),n,&n));return b;};
 auto user=info(TokenUser),groups=info(TokenGroups),session=info(TokenSessionId);
 Identity id;id.sid=sidText(reinterpret_cast<TOKEN_USER*>(user.data())->User.Sid);id.session=*reinterpret_cast<DWORD*>(session.data());id.pid=pid;id.born=creation(process.h);
 auto g=reinterpret_cast<TOKEN_GROUPS*>(groups.data());
 for(DWORD i=0;i<g->GroupCount;i++)if((g->Groups[i].Attributes&SE_GROUP_LOGON_ID)==SE_GROUP_LOGON_ID){require(id.logon.empty());id.logon=sidText(g->Groups[i].Sid);}
 require(id.logon.rfind(L"S-1-5-5-",0)==0);return id;
}
static DWORD parentPid(DWORD pid){
 Handle snap(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));require(snap.h!=INVALID_HANDLE_VALUE);PROCESSENTRY32W row{};row.dwSize=sizeof(row);
 if(Process32FirstW(snap.h,&row))do{if(row.th32ProcessID==pid)return row.th32ParentProcessID;}while(Process32NextW(snap.h,&row));
 throw std::runtime_error("WINDOWS_NATIVE_PIPE_REJECTED");
}
static DWORD scmPid(){
 SC_HANDLE manager=OpenSCManagerW(nullptr,nullptr,SC_MANAGER_CONNECT);require(manager!=nullptr);
 SC_HANDLE service=OpenServiceW(manager,L"CamachoPOSLocalService",SERVICE_QUERY_STATUS);if(!service){CloseServiceHandle(manager);throw std::runtime_error("WINDOWS_NATIVE_PIPE_REJECTED");}
 SERVICE_STATUS_PROCESS s{};DWORD n=0;BOOL ok=QueryServiceStatusEx(service,SC_STATUS_PROCESS_INFO,reinterpret_cast<BYTE*>(&s),sizeof(s),&n);
 CloseServiceHandle(service);CloseServiceHandle(manager);require(ok&&(s.dwCurrentState==SERVICE_RUNNING||s.dwCurrentState==SERVICE_START_PENDING)&&s.dwProcessId!=0);return s.dwProcessId;
}
static void serviceIdentity(const Identity& peer,const std::wstring& sid){
 require(peer.sid==sid&&peer.session==0);DWORD expected=scmPid(),pid=peer.pid;uint64_t child=peer.born;
 bool found=false;for(unsigned i=0;i<16;i++){
  Identity current=identity(pid);require(current.sid==sid&&current.session==0&&current.born<=child);
  if(pid==expected){found=true;break;}child=current.born;DWORD parent=parentPid(pid);require(parent&&parent!=pid);pid=parent;
 }require(found&&scmPid()==expected);
}
struct Policy{std::wstring endpoint,service,recipient,logon;DWORD session;};
static Policy policy(napi_env e,napi_value* a){Policy p{str(e,a[0]),str(e,a[1]),str(e,a[2]),str(e,a[3]),num(e,a[4])};
 require(p.endpoint.rfind(L"\\\\.\\pipe\\camacho-pos-",0)==0&&p.endpoint.find(L'\\',9)==std::wstring::npos&&p.session>0);
 sidValid(p.service);sidValid(p.recipient);sidValid(p.logon);require(p.service.rfind(L"S-1-5-80-",0)==0&&p.recipient.rfind(L"S-1-5-21-",0)==0&&p.logon.rfind(L"S-1-5-5-",0)==0);return p;}
static Identity peerIdentity(HANDLE pipe,bool server,const Policy& p){
 ULONG pid=0,session=0;require(server?GetNamedPipeClientProcessId(pipe,&pid):GetNamedPipeServerProcessId(pipe,&pid));
 require(server?GetNamedPipeClientSessionId(pipe,&session):GetNamedPipeServerSessionId(pipe,&session));
 Identity id=identity(pid);require(id.session==session);
 if(server)require(id.sid==p.recipient&&id.logon==p.logon&&id.session==p.session);
 else serviceIdentity(id,p.service);
 ULONG again=0;require(server?GetNamedPipeClientProcessId(pipe,&again):GetNamedPipeServerProcessId(pipe,&again));require(pid==again);return id;
}
// Use libuv's descriptor table, not the addon's private /MT CRT table.
// Node and Electron may link different CRTs; raw _open_osfhandle is unsafe.
static void closeFd(int fd){uv_fs_t request{};uv_fs_close(nullptr,&request,fd,nullptr);uv_fs_req_cleanup(&request);}
struct Connection{int fd=-1;bool adopted=false,closed=false,server=false;HANDLE proof=INVALID_HANDLE_VALUE;Policy p;Identity peer;~Connection(){release();}void release(){if(closed)return;closed=true;if(proof!=INVALID_HANDLE_VALUE)CloseHandle(proof);proof=INVALID_HANDLE_VALUE;if(fd>=0&&!adopted)closeFd(fd);fd=-1;}};
static std::unique_ptr<Connection> connection(HANDLE pipe,bool server,const Policy& p){
 auto c=std::make_unique<Connection>();c->p=p;c->server=server;c->peer=peerIdentity(pipe,server,p);
 require(DuplicateHandle(GetCurrentProcess(),pipe,GetCurrentProcess(),&c->proof,0,FALSE,DUPLICATE_SAME_ACCESS));
 c->fd=uv_open_osfhandle(pipe);require(c->fd>=0);return c;
}
struct Listener{Policy p;HANDLE pending=INVALID_HANDLE_VALUE,stop=INVALID_HANDLE_VALUE;bool closed=false,busy=false;std::mutex mutex;~Listener(){if(pending!=INVALID_HANDLE_VALUE)CloseHandle(pending);if(stop!=INVALID_HANDLE_VALUE)CloseHandle(stop);}};
static HANDLE makePipe(const Policy& p,bool first){
 // Specific data rights deliberately exclude FILE_CREATE_PIPE_INSTANCE (0x4).
 std::wstring sddl=L"O:"+p.service+L"D:P(A;;GA;;;SY)(A;;GA;;;"+p.service+L")(A;;0x120183;;;"+p.logon+L")";
 PSECURITY_DESCRIPTOR sd=nullptr;require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(),SDDL_REVISION_1,&sd,nullptr));
 SECURITY_ATTRIBUTES sa{sizeof(sa),sd,FALSE};HANDLE pipe=CreateNamedPipeW(p.endpoint.c_str(),PIPE_ACCESS_DUPLEX|FILE_FLAG_OVERLAPPED|(first?FILE_FLAG_FIRST_PIPE_INSTANCE:0),PIPE_TYPE_BYTE|PIPE_READMODE_BYTE|PIPE_WAIT|PIPE_REJECT_REMOTE_CLIENTS,32,65536,65536,0,&sa);LocalFree(sd);require(pipe!=INVALID_HANDLE_VALUE);return pipe;
}
template<class T>static T* ext(napi_env e,napi_value v){void* p=nullptr;check(napi_get_value_external(e,v,&p));require(p!=nullptr);return static_cast<T*>(p);}
static napi_value undefined(napi_env e){napi_value v;check(napi_get_undefined(e,&v));return v;}
static void prop(napi_env e,napi_value obj,const char* key,napi_value value){check(napi_set_named_property(e,obj,key,value));}
static napi_value jsString(napi_env e,const std::wstring& s){napi_value v;check(napi_create_string_utf16(e,reinterpret_cast<const char16_t*>(s.data()),s.size(),&v));return v;}
static napi_value jsNum(napi_env e,uint32_t n){napi_value v;check(napi_create_uint32(e,n,&v));return v;}
static napi_value wrap(napi_env e,std::unique_ptr<Connection> c){
 napi_value obj,handle,peer;check(napi_create_object(e,&obj));check(napi_create_object(e,&peer));
 check(napi_create_external(e,c.get(),[](napi_env,void* p,void*){delete static_cast<Connection*>(p);},nullptr,&handle));Connection* raw=c.release();
 prop(e,obj,"handle",handle);prop(e,obj,"fd",jsNum(e,raw->fd));prop(e,peer,"sid",jsString(e,raw->peer.sid));prop(e,peer,"logonSid",jsString(e,raw->peer.logon));prop(e,peer,"sessionId",jsNum(e,raw->peer.session));prop(e,peer,"pid",jsNum(e,raw->peer.pid));prop(e,peer,"creationTime",jsString(e,std::to_wstring(raw->peer.born)));prop(e,obj,"peer",peer);return obj;
}
static napi_value Listen(napi_env e,napi_callback_info info){try{
 size_t n=5;napi_value a[5];check(napi_get_cb_info(e,info,&n,a,nullptr,nullptr));require(n==5);auto l=std::make_unique<Listener>();l->p=policy(e,a);serviceIdentity(identity(GetCurrentProcessId()),l->p.service);
 l->stop=CreateEventW(nullptr,TRUE,FALSE,nullptr);require(l->stop!=nullptr);l->pending=makePipe(l->p,true);napi_value out,handle;check(napi_create_object(e,&out));check(napi_create_external(e,l.get(),[](napi_env,void* p,void*){delete static_cast<Listener*>(p);},nullptr,&handle));l.release();prop(e,out,"handle",handle);return out;
 }catch(...){return reject(e);}}
struct Work{napi_env env=nullptr;napi_deferred deferred;napi_async_work work=nullptr;napi_ref ref=nullptr;Listener* listener=nullptr;Policy p;DWORD timeout=0;bool failed=false,claimed=false,queued=false;std::unique_ptr<Connection> result;
 ~Work(){if(listener&&claimed&&!queued){std::lock_guard<std::mutex>lock(listener->mutex);listener->busy=false;}if(ref)napi_delete_reference(env,ref);if(work)napi_delete_async_work(env,work);}
};
static void execute(napi_env,void* data){auto w=static_cast<Work*>(data);HANDLE pipe=INVALID_HANDLE_VALUE;try{
 if(w->listener){
  auto l=w->listener;pipe=l->pending;Handle event(CreateEventW(nullptr,TRUE,FALSE,nullptr));require(event.h!=nullptr);OVERLAPPED ov{};ov.hEvent=event.h;
  BOOL connected=ConnectNamedPipe(pipe,&ov);DWORD error=connected?ERROR_SUCCESS:GetLastError();
  if(!connected&&error==ERROR_IO_PENDING){HANDLE events[]{event.h,l->stop};DWORD result=WaitForMultipleObjects(2,events,FALSE,w->timeout);DWORD bytes;
   if(result!=WAIT_OBJECT_0){CancelIoEx(pipe,&ov);GetOverlappedResult(pipe,&ov,&bytes,TRUE);throw std::runtime_error("WINDOWS_NATIVE_PIPE_REJECTED");}
   require(GetOverlappedResult(pipe,&ov,&bytes,FALSE));
  }else require(connected||error==ERROR_PIPE_CONNECTED);
  // Hold the namespace continuously: create the next instance BEFORE handing
  // ownership of the accepted instance to libuv or closing an invalid peer.
  peerIdentity(pipe,true,l->p);Handle next(makePipe(l->p,false));
  {std::lock_guard<std::mutex> lock(l->mutex);require(!l->closed);l->pending=next.h;next.h=INVALID_HANDLE_VALUE;}
  w->result=connection(pipe,true,l->p);pipe=INVALID_HANDLE_VALUE;
 }else{
  Identity self=identity(GetCurrentProcessId());require(self.sid==w->p.recipient&&self.logon==w->p.logon&&self.session==w->p.session);
  ULONGLONG until=GetTickCount64()+w->timeout;
  do{pipe=CreateFileW(w->p.endpoint.c_str(),FILE_READ_DATA|FILE_WRITE_DATA|FILE_READ_ATTRIBUTES|FILE_WRITE_ATTRIBUTES|READ_CONTROL|SYNCHRONIZE,0,nullptr,OPEN_EXISTING,FILE_FLAG_OVERLAPPED|SECURITY_SQOS_PRESENT|SECURITY_IDENTIFICATION,nullptr);
   if(pipe!=INVALID_HANDLE_VALUE)break;require(GetLastError()==ERROR_PIPE_BUSY&&GetTickCount64()<until);WaitNamedPipeW(w->p.endpoint.c_str(),100);
  }while(true);
  w->result=connection(pipe,false,w->p);pipe=INVALID_HANDLE_VALUE;
 }
 }catch(...){w->failed=true;if(pipe!=INVALID_HANDLE_VALUE){if(w->listener&&w->listener->pending==pipe)DisconnectNamedPipe(pipe);else CloseHandle(pipe);}}
 if(w->listener){auto l=w->listener;std::lock_guard<std::mutex>lock(l->mutex);l->busy=false;if(l->closed&&l->pending!=INVALID_HANDLE_VALUE){CloseHandle(l->pending);l->pending=INVALID_HANDLE_VALUE;}}
}
static void complete(napi_env e,napi_status status,void* data){std::unique_ptr<Work>w(static_cast<Work*>(data));try{
 if(status!=napi_ok||w->failed||!w->result)throw std::runtime_error("WINDOWS_NATIVE_PIPE_REJECTED");
 check(napi_resolve_deferred(e,w->deferred,wrap(e,std::move(w->result))));
 }catch(...){napi_value message,error;napi_create_string_utf8(e,"WINDOWS_NATIVE_PIPE_REJECTED",NAPI_AUTO_LENGTH,&message);napi_create_error(e,nullptr,message,&error);napi_reject_deferred(e,w->deferred,error);}

}
static napi_value async(napi_env e,std::unique_ptr<Work>w){napi_value promise,name;check(napi_create_promise(e,&w->deferred,&promise));check(napi_create_string_utf8(e,"windows-pipe",NAPI_AUTO_LENGTH,&name));check(napi_create_async_work(e,nullptr,name,execute,complete,w.get(),&w->work));check(napi_queue_async_work(e,w->work));w->queued=true;w.release();return promise;}
static napi_value Accept(napi_env e,napi_callback_info info){try{size_t n=2;napi_value a[2];check(napi_get_cb_info(e,info,&n,a,nullptr,nullptr));require(n==2);auto w=std::make_unique<Work>();w->env=e;napi_value handle;check(napi_get_named_property(e,a[0],"handle",&handle));w->listener=ext<Listener>(e,handle);w->timeout=num(e,a[1]);require(w->timeout>=10&&w->timeout<=5000);
 {std::lock_guard<std::mutex>lock(w->listener->mutex);require(!w->listener->closed&&!w->listener->busy);w->listener->busy=true;w->claimed=true;}
 check(napi_create_reference(e,a[0],1,&w->ref));return async(e,std::move(w));}catch(...){return reject(e);}}
static napi_value Connect(napi_env e,napi_callback_info info){try{size_t n=6;napi_value a[6];check(napi_get_cb_info(e,info,&n,a,nullptr,nullptr));require(n==6);auto w=std::make_unique<Work>();w->env=e;w->p=policy(e,a);w->timeout=num(e,a[5]);require(w->timeout>=10&&w->timeout<=5000);return async(e,std::move(w));}catch(...){return reject(e);}}
static napi_value Stop(napi_env e,napi_callback_info info){try{size_t n=1;napi_value a;check(napi_get_cb_info(e,info,&n,&a,nullptr,nullptr));require(n==1);napi_value handle;check(napi_get_named_property(e,a,"handle",&handle));auto l=ext<Listener>(e,handle);std::lock_guard<std::mutex>lock(l->mutex);l->closed=true;SetEvent(l->stop);if(!l->busy&&l->pending!=INVALID_HANDLE_VALUE){CloseHandle(l->pending);l->pending=INVALID_HANDLE_VALUE;}return undefined(e);}catch(...){return reject(e);}}
static napi_value Adopt(napi_env e,napi_callback_info info){try{size_t n=1;napi_value a;check(napi_get_cb_info(e,info,&n,&a,nullptr,nullptr));require(n==1);auto c=ext<Connection>(e,a);require(!c->closed&&!c->adopted);if(c->fd<=2){closeFd(c->fd);c->fd=-1;}c->adopted=true;return undefined(e);}catch(...){return reject(e);}}
static napi_value Release(napi_env e,napi_callback_info info){try{size_t n=1;napi_value a;check(napi_get_cb_info(e,info,&n,&a,nullptr,nullptr));require(n==1);ext<Connection>(e,a)->release();return undefined(e);}catch(...){return reject(e);}}
static napi_value Recheck(napi_env e,napi_callback_info info){try{size_t n=1;napi_value a;check(napi_get_cb_info(e,info,&n,&a,nullptr,nullptr));require(n==1);auto c=ext<Connection>(e,a);require(!c->closed);Identity current=peerIdentity(c->proof,c->server,c->p);require(current.pid==c->peer.pid&&current.born==c->peer.born&&current.sid==c->peer.sid&&current.logon==c->peer.logon&&current.session==c->peer.session);return undefined(e);}catch(...){return reject(e);}}
#else
static napi_value unsupported(napi_env e,napi_callback_info){napi_throw_error(e,nullptr,"WINDOWS_NATIVE_PIPE_REQUIRED");return nullptr;}
#endif
NAPI_MODULE_INIT(){
#ifdef _WIN32
 napi_property_descriptor properties[]={{"listen",nullptr,Listen,nullptr,nullptr,nullptr,napi_default,nullptr},{"accept",nullptr,Accept,nullptr,nullptr,nullptr,napi_default,nullptr},{"connect",nullptr,Connect,nullptr,nullptr,nullptr,napi_default,nullptr},{"stop",nullptr,Stop,nullptr,nullptr,nullptr,napi_default,nullptr},{"adopt",nullptr,Adopt,nullptr,nullptr,nullptr,napi_default,nullptr},{"release",nullptr,Release,nullptr,nullptr,nullptr,napi_default,nullptr},{"recheck",nullptr,Recheck,nullptr,nullptr,nullptr,napi_default,nullptr}};
#else
 napi_property_descriptor properties[]={{"listen",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr},{"accept",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr},{"connect",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr},{"stop",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr},{"adopt",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr},{"release",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr},{"recheck",nullptr,unsupported,nullptr,nullptr,nullptr,napi_default,nullptr}};
#endif
 check(napi_define_properties(env,exports,sizeof(properties)/sizeof(properties[0]),properties));return exports;
}
