import { LocalChannelAuthenticator } from "@pos-platform/local-channel";
import type { ContractVersionRange } from "@pos-platform/contracts";
import { connectLocalServiceChannel } from "./local-service-channel.js";
import { bootstrap, type DesktopLogger } from "./main.js";
import {DesktopCommercialAccount,readDesktopCommercialConfiguration} from "./commercial-account.js";
import {createElectronBusinessCredentialVault} from "./electron-business-login.js";
import {app,shell} from "electron";

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
  readonly channelSecret: Buffer;
  readonly protocolRange: ContractVersionRange;
  /** Sobre `runtime.handshake` que el canal negocia al conectar. */
  readonly handshake: unknown;
  readonly logger?: DesktopLogger;
  readonly timeoutMs?: number;
  readonly commercialFile?:string;
}

export async function startPosDesktop(options: PosDesktopStartOptions): Promise<void> {
  const authenticator = new LocalChannelAuthenticator(options.channelSecret);
  let channel;
  try {
    channel = await connectLocalServiceChannel({
      endpoint: options.endpoint,
      authenticator,
      protocolRange: options.protocolRange,
      handshake: options.handshake,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  } catch (error) {
    // Un POS que cree estar conectado y no lo está es peor que uno que sabe que
    // no lo está (`DEC-010` §156): no se abre ventana sin canal.
    authenticator.destroy();
    throw error;
  }

  await app.whenReady();
  const commercial=options.commercialFile?readDesktopCommercialConfiguration(options.commercialFile):undefined;
  const account=commercial?new DesktopCommercialAccount(commercial,async()=>{
    const nativeAuthenticator=new LocalChannelAuthenticator(options.channelSecret);
    try{const connected=await connectLocalServiceChannel({endpoint:options.endpoint,authenticator:nativeAuthenticator,protocolRange:options.protocolRange,
      handshake:options.handshake,timeoutMs:commercial.attempt_timeout_ms});
      return {request:input=>connected.request(input),close:async()=>{try{await connected.close();}finally{nativeAuthenticator.destroy();}}};}
    catch(error){nativeAuthenticator.destroy();throw error;}
  },createElectronBusinessCredentialVault(),url=>shell.openExternal(url,{activate:true})):undefined;
  await bootstrap(channel, options.logger,account);
}
