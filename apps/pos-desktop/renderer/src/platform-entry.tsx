import { BrandMark } from "./components/BrandMark.js";
import {useCallback,useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import "./App.css";
import "./commercial-precision.css";
import {AdministrativeControlPanel} from "./components/AdministrativeControlPanel.js";
import {PlatformClient,type PublishedOffer} from "./platform-client.js";
import {PlatformOfferEditor} from "./components/PlatformOfferEditor.js";

export function PlatformAdministrationPortal(){
  const [client]=useState(()=>window.location.protocol==="https:"?new PlatformClient():null);
  const [authenticated,setAuthenticated]=useState(false),[offers,setOffers]=useState<PublishedOffer[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const refresh=useCallback(async()=>{if(!client)return;setOffers(await client.offers());},[client]);
  async function login(form:HTMLFormElement){
    if(!client||busy)return;
    const input=form.elements.namedItem("password") as HTMLInputElement,email=form.elements.namedItem("email") as HTMLInputElement;
    let password=input.value;input.value="";setBusy(true);setError(null);setNotice(null);controller.current=new AbortController();
    try{await client.login(email.value,password,controller.current.signal);await refresh();setAuthenticated(true);}
    catch(e){setOffers([]);setAuthenticated(false);setError(e instanceof Error?e.message:"No se pudo iniciar sesión.");}
    finally{password="";controller.current=null;setBusy(false);}
  }
  async function logout(){setBusy(true);setError(null);
    try{await client?.logout();setNotice("Central confirmó el cierre de sesión.");}
    catch{setError("No se pudo confirmar el cierre en Central. La sesión remota puede seguir vigente hasta su caducidad.");}
    finally{setOffers([]);setAuthenticated(false);setBusy(false);}
  }
  if(!authenticated||!client)return <main className="pos-entry">
    <section className="pos-entry-brand"><BrandMark variant="entry" /></section>
    <section className="pos-entry-card"><span className="pos-entry-eyebrow">CAMACHO POS COLOMBIA</span><h1>Administración de plataforma</h1>
      <p>Se exige contraseña, autenticador y permiso GLOBAL. La sesión comercial del POS no concede este acceso.</p>
      {!client?<p role="alert">Abre este panel en el origen HTTPS administrado de Central.</p>:<form onSubmit={e=>{e.preventDefault();void login(e.currentTarget);}}>
        <label>Correo<input name="email" aria-label="Correo" type="email" autoComplete="username" maxLength={320} required disabled={busy}/></label>
        <label>Contraseña<input name="password" aria-label="Contraseña" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy}/></label>
        <button type="submit" disabled={busy}>{busy?"Verificando identidad…":"Ingresar con autenticador"}</button>
        <button type="button" disabled={!busy} onClick={()=>controller.current?.abort()}>Cancelar</button>
      </form>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    </section></main>;
  return <main className="pos-main"><BrandMark variant="header" /><AdministrativeControlPanel kind="superadmin" platform={{client,offers,onChanged:refresh}} platformEditor={<PlatformOfferEditor client={client} offers={offers} onChanged={refresh}/>}/>
    <button type="button" disabled={busy} onClick={()=>void logout()}>Cerrar sesión GLOBAL</button>{error&&<p role="alert">{error}</p>}</main>;
}
const root=document.getElementById("root");if(!root)throw Error("Elemento raíz no disponible");createRoot(root).render(<PlatformAdministrationPortal/>);
