import {beforeEach,describe,expect,it,vi} from "vitest";
const h=vi.hoisted(()=>({ready:vi.fn(),bootstrap:vi.fn(),once:vi.fn(),legacy:vi.fn(),commercial:vi.fn(),config:vi.fn()}));
vi.mock("electron",()=>({app:{whenReady:h.ready,once:h.once},shell:{},session:{}}));
vi.mock("../src/main.js",()=>({bootstrap:h.bootstrap}));
vi.mock("../src/local-service-channel.js",()=>({connectLocalServiceChannel:h.legacy}));
vi.mock("../src/commercial-account.js",()=>({DesktopCommercialAccount:h.commercial,readDesktopCommercialConfiguration:h.config}));
vi.mock("../src/electron-business-login.js",()=>({createElectronBusinessCredentialVault:vi.fn()}));
import {startPosDesktop} from "../src/start.js";
const options={endpoint:"SCM",protocolRange:{min:"1.0.0",max:"1.0.0"},handshake:{}};
beforeEach(()=>{vi.clearAllMocks();h.ready.mockResolvedValue(undefined);h.bootstrap.mockResolvedValue(undefined);});
describe("Electron main SCM channel custody (mocked Electron, no Windows certification)",()=>{
 it("starts using the authenticated factory without loading a master secret",async()=>{
  const channel={request:vi.fn(),close:vi.fn()},factory=vi.fn().mockResolvedValue(channel);
  await startPosDesktop({...options,channelFactory:factory});
  expect(factory).toHaveBeenCalledOnce();expect(h.bootstrap).toHaveBeenCalledWith(expect.objectContaining({request:expect.any(Function),close:expect.any(Function)}),undefined,undefined,undefined);
  const bridge=h.bootstrap.mock.calls[0]![0];await bridge.request({probe:true});expect(channel.request).toHaveBeenCalledWith({probe:true});expect(h.legacy).not.toHaveBeenCalled();
 });
 it("closes the supplied channel when readiness fails",async()=>{
  const channel={request:vi.fn(),close:vi.fn().mockResolvedValue(undefined)};h.ready.mockRejectedValueOnce(Error("not ready"));
  await expect(startPosDesktop({...options,channelFactory:async()=>channel})).rejects.toThrow("not ready");expect(channel.close).toHaveBeenCalledOnce();
 });
 it("does not open the panel when native channel admission fails",async()=>{
  await expect(startPosDesktop({...options,channelFactory:async()=>{throw Error("peer rejected");}})).rejects.toThrow();expect(h.bootstrap).not.toHaveBeenCalled();
 });
 it("rejects ambiguous custody and missing custody",async()=>{
  await expect(startPosDesktop(options)).rejects.toThrow("CUSTODY");
  await expect(startPosDesktop({...options,channelSecret:Buffer.alloc(32),channelFactory:vi.fn()})).rejects.toThrow("CUSTODY");expect(h.bootstrap).not.toHaveBeenCalled();
 });
 it.each(["login","logout"])("replaces the panel channel after explicit %s without replaying operations",async operation=>{
  const previous={request:vi.fn(),close:vi.fn().mockResolvedValue(undefined)},fresh={request:vi.fn(),close:vi.fn()};
  const action={login:vi.fn().mockResolvedValue("SESSION_ACTIVATED"),logout:vi.fn().mockResolvedValue("SIGNED_OUT"),stop:vi.fn()};
  h.config.mockReturnValue({registration:{},attempt_timeout_ms:3000});h.commercial.mockImplementation(function(){return action;});
  const factory=vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(fresh);
  await startPosDesktop({...options,commercialFile:"managed-public-profile",channelFactory:factory});
  const [bridge,,account]=h.bootstrap.mock.calls[0]!;await account[operation]();
  expect(factory).toHaveBeenCalledTimes(2);expect(previous.close).toHaveBeenCalledOnce();
  await bridge.request({next_operation:true});expect(fresh.request).toHaveBeenCalledExactlyOnceWith({next_operation:true});expect(previous.request).not.toHaveBeenCalled();
 });
 it("does not open another panel connection during Electron shutdown",async()=>{
  const channel={request:vi.fn(),close:vi.fn()},action={login:vi.fn(),logout:vi.fn().mockResolvedValue("SIGNED_OUT"),stop:vi.fn()};
  h.config.mockReturnValue({registration:{},attempt_timeout_ms:3000});h.commercial.mockImplementation(function(){return action;});
  const factory=vi.fn().mockResolvedValue(channel);await startPosDesktop({...options,commercialFile:"managed-public-profile",channelFactory:factory});
  h.once.mock.calls.find(([name])=>name==="before-quit")![1]();
  await h.bootstrap.mock.calls[0]![2].logout();expect(factory).toHaveBeenCalledOnce();
 });

});
