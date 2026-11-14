import { LocalChannelAuthenticator } from "@pos-platform/local-channel";
import type { ContractVersionRange } from "@pos-platform/contracts";
import { connectLocalServiceChannel } from "./local-service-channel.js";
import { bootstrap, type DesktopLogger } from "./main.js";
import {DesktopCommercialAccount,readDesktopCommercialConfiguration,type DesktopAccountActions} from "./commercial-account.js";
import {createElectronBusinessCredentialVault} from "./electron-business-login.js";
import {app,shell,session} from "electron";
import {BrowserCacheMaintenance} from "./browser-cache-maintenance.js";
import type {ServiceChannel} from "./channel-bridge.js";

/**
 * El arranque del POS de escritorio, **sin decidir de dónde vienen las claves**.
 *
 * `main.ts` exporta `bootstrap(serviceChannel)` y no se auto-ejecuta: alguien
 * tiene que construir el canal. Eso es lo que hace esta función, y es el único
 * sitio donde se hace. Producción y verificación comparten exactamente este
 * camino —mismo cliente, mismo socket, mismo MAC, mismo anti-replay—; lo único
 * que las distingue es **quién resuelve la credencial**, que entra por
 * parámetro y nunca por una rama `if (platform)`.
 *
 * Es deliberado que el secreto llegue ya resuelto: quien arranca el escritorio
 * no debe saber si detrás hay DPAPI, un handshake autorizado o un arnés de
 * prueba. Esa ignorancia es la que permite cambiar el mecanismo de Windows sin
 * tocar una línea de aquí.
 */
export interface PosDesktopStartOptions {
  /** Ruta del canal: named pipe en Windows, socket POSIX en verificación. */
  readonly endpoint: string;
  /**
   * Secreto del canal, **ya resuelto**. Se copia al autenticador y el original
   * queda a cargo de quien lo obtuvo.
   */
  readonly channelSecret?: Buffer;
  /** Trusted main-process factory; never serialized or supplied by renderer. */
  readonly channelFactory?:()=>Promise<ServiceChannel>;
  readonly protocolRange: ContractVersionRange;
  /** Sobre `runtime.handshake` que el canal negocia al conectar. */
  readonly handshake: unknown;
  readonly logger?: DesktopLogger;
  readonly timeoutMs?: number;
  readonly commercialFile?:string;
}

export async function startPosDesktop(options: PosDesktopStartOptions): Promise<void> {
  if((options.channelSecret===undefined)===(options.channelFactory===undefined))throw Error("DESKTOP_CHANNEL_CUSTODY_REQUIRED");
  const authenticator = options.channelSecret===undefined?undefined:new LocalChannelAuthenticator(options.channelSecret);
  let channel:ServiceChannel;
  try {
    channel = options.channelFactory?await options.channelFactory():await connectLocalServiceChannel({
      endpoint: options.endpoint,
      authenticator:authenticator!,
      protocolRange: options.protocolRange,
      handshake: options.handshake,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  } catch (error) {
    // Un POS que cree estar conectado y no lo está es peor que uno que sabe que
    // no lo está (`DEC-010` §156): no se abre ventana sin canal.
    authenticator?.destroy();
    options.channelSecret?.fill(0);
    throw error;
  }

  try {
    await app.whenReady();
    const commercial=options.commercialFile?readDesktopCommercialConfiguration(options.commercialFile):undefined;
    const accountImplementation=commercial?new DesktopCommercialAccount(commercial,options.channelFactory??(async()=>{
      const nativeAuthenticator=new LocalChannelAuthenticator(options.channelSecret!);
      try{const connected=await connectLocalServiceChannel({endpoint:options.endpoint,authenticator:nativeAuthenticator,protocolRange:options.protocolRange,
        handshake:options.handshake,timeoutMs:commercial.attempt_timeout_ms});
        return {request:input=>connected.request(input),close:async()=>{try{await connected.close();}finally{nativeAuthenticator.destroy();}}};}
      catch(error){nativeAuthenticator.destroy();throw error;}
    }),createElectronBusinessCredentialVault(),url=>shell.openExternal(url,{activate:true})):undefined;
    let closing=false;
    let account:DesktopAccountActions|undefined=accountImplementation;
    if(accountImplementation&&options.channelFactory){
      const implementation=accountImplementation,factory=options.channelFactory;
      app.once("before-quit",()=>{closing=true;});
      const refreshPanelChannel=async()=>{
        if(closing)return;
        const replacement=await factory();
        if(closing){await replacement.close();return;}
        const previous=channel;channel=replacement;
        await previous.close();
      };
      account={login:async()=>{try{return await implementation.login();}finally{await refreshPanelChannel();}},
        logout:async()=>{try{return await implementation.logout();}finally{await refreshPanelChannel();}},stop:()=>implementation.stop()};
    }
    // The bridge keeps this delegate while explicit account transitions replace
    // its retired socket. No operation is retried after uncertain delivery.
    const panelChannel:ServiceChannel=options.channelFactory?{request:input=>channel.request(input),close:()=>channel.close()}:channel;
    const cache=commercial?.browser_cache?new BrowserCacheMaintenance(session.defaultSession,commercial.browser_cache):undefined;
    await bootstrap(panelChannel, options.logger,account,cache);
    // The launcher's original secret is needed to authenticate additional
    // account channels during this Electron process, but never after exit.
    // The authenticator holds its own copy; erase both on normal shutdown.
    app.once("will-quit",()=>{
      authenticator?.destroy();
      options.channelSecret?.fill(0);
    });
  } catch (error) {
    // Never leave a connected, credential-bearing local channel alive if
    // config loading, Electron readiness, or bootstrap fails after handshake.
    try{await channel.close();}catch{/* preserve the startup failure */}
    authenticator?.destroy();
    options.channelSecret?.fill(0);
    throw error;
  }
}
