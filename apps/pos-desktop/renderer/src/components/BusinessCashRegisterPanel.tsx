import { useEffect, useRef, useState } from "react";
import { uuidV7, type CashRegisterMasterRow, type BusinessContextsSchema, type CashRegisterCreateRequest } from "@pos-platform/contracts";
import type * as z from "zod";
import { BusinessClient } from "../business-client.js";

type Context = z.infer<typeof BusinessContextsSchema>["contexts"][number];
export function BusinessCashRegisterPanel(): React.JSX.Element {
  const [client] = useState(() => new BusinessClient());
  const [authenticated, setAuthenticated] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [contexts, setContexts] = useState<Context[]>([]), [selected, setSelected] = useState("");
  const [registers, setRegisters] = useState<CashRegisterMasterRow[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null);
  const [editing, setEditing] = useState<CashRegisterMasterRow | null>(null);
  const [createId, setCreateId] = useState(() => uuidV7());
  const pendingCreate = useRef<CashRegisterCreateRequest | null>(null);
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const current = contexts[Number(selected)];
  useEffect(() => () => controller.current?.abort(), []);
  async function run(work: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setError(null); setNotice(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Operación no confirmada.");
      if (!client.hasSession) { setAuthenticated(false); setContexts([]); setRegisters([]); setSelected(""); setEditing(null); }
    }
    finally { running.current = false; setBusy(false); }
  }
  async function load(context: Context, after: string | null = null) {
    const { companyId, branchId, licenseId } = context;
    const result = await client.list({ companyId, branchId, licenseId }, after);
    setRegisters(result.registers); setNextCursor(result.nextCursor); setEditing(null);
  }
  if (!authenticated) return <section className="pos-admin-panel" aria-label="Acceso BUSINESS">
    <h2>Administración de cajas</h2><p>Inicia sesión con tu cuenta empresarial y autenticador. Usa los identificadores de organización y membresía entregados con tu alta.</p>
    <form onSubmit={e => { e.preventDefault(); const f = e.currentTarget, data = new FormData(f);
      const password = String(data.get("password")); (f.elements.namedItem("password") as HTMLInputElement).value = "";
      void run(async () => { controller.current = new AbortController();
        await client.login(String(data.get("email")), password, String(data.get("tenant")), String(data.get("membership")), controller.current.signal);
        setAuthenticated(true); const result = await client.contexts(); setContexts(result.contexts);
        const pending = pendingCreate.current;
        if (pending) {
          const index = result.contexts.findIndex(c => c.companyId === pending.companyId && c.branchId === pending.branchId && c.licenseId === pending.licenseId);
          if (index >= 0) { setSelected(String(index)); await load(result.contexts[index]!); }
          else setNotice("Hay una creación pendiente en otro ámbito. Inicia sesión con la cuenta autorizada para reconciliarla.");
        }
        if (result.truncated) setNotice("Se muestran los primeros 100 ámbitos autorizados.");
      }); }}>
      <label>Correo<input name="email" type="email" autoComplete="username" required maxLength={320} disabled={busy}/></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={busy}/></label>
      <label>Organización<input name="tenant" required maxLength={36} disabled={busy}/></label>
      <label>Membresía<input name="membership" required maxLength={36} disabled={busy}/></label>
      <button disabled={busy}>Ingresar con autenticador</button>
      <button type="button" disabled={!busy} onClick={() => controller.current?.abort()}>Cancelar</button>
    </form>{error && <p role="alert">{error}</p>}
  </section>;
  return <section className="pos-admin-panel" aria-label="Administración de cajas BUSINESS" aria-busy={busy}>
    <h2>Administración de cajas</h2>
    <p>El retiro conserva la historia. Las asignaciones de licencia anteriores requieren un protocolo de liberación para recuperar capacidad.</p>
    <label>Empresa, sucursal y licencia<select value={selected} disabled={busy || pendingCreate.current !== null} onChange={e => {
      setSelected(e.target.value); setRegisters([]); setEditing(null); setNextCursor(null);
      const context = contexts[Number(e.target.value)]; if (context && e.target.value !== "") void run(() => load(context));
    }}><option value="">Selecciona un ámbito</option>{contexts.map((c, i) => <option key={`${c.companyId}/${c.branchId}/${c.licenseId}`} value={i}>{c.companyName} · {c.branchName} · {c.licenseName}</option>)}</select></label>
    {contexts.length === 0 && <p>No hay ámbitos con permiso de administrar cajas y licencia comercial disponible.</p>}
    <button disabled={busy || selected === ""} onClick={() => current && void run(() => load(current))}>Actualizar cajas</button>
    {selected !== "" && current && <>
      <form key={`${selected}/${editing?.id ?? createId}/${editing?.version ?? 0}`} onSubmit={e => {
        e.preventDefault(); const form = e.currentTarget, data = new FormData(form);
        const code = pendingCreate.current?.code ?? String(data.get("code")), name = pendingCreate.current?.name ?? String(data.get("name"));
        // Keep the complete intent and correlation through uncertain replies.
        // This is memory-only; refresh/restart requires reconciling the list.
        const id = String(data.get("id"));
        void run(async () => { const scope = { companyId: current.companyId, branchId: current.branchId, licenseId: current.licenseId };
          if (editing) await client.edit(scope, editing, code, name);
          else {
            const pending = pendingCreate.current;
            if (pending && (pending.id !== id || pending.companyId !== scope.companyId || pending.branchId !== scope.branchId ||
                pending.licenseId !== scope.licenseId || pending.code !== code || pending.name !== name || pending.currency !== current.currency)) {
              throw Error("Conserva los datos de la creación pendiente para reintentar.");
            }
            const request = pending ?? { ...scope,id,code,name,currency:current.currency,correlationId:uuidV7() };
            pendingCreate.current = request;
            await client.create(scope, { id: request.id, code: request.code, name: request.name, currency: request.currency, correlationId: request.correlationId });
            pendingCreate.current = null;
          }
          setCreateId(uuidV7()); await load(current); form.reset(); setNotice("Central confirmó la operación."); });
      }}>
        <h3>{editing ? "Editar caja" : "Crear caja"}</h3>
        <input type="hidden" name="id" value={editing?.id ?? createId}/>
        <label>Código<input name="code" required maxLength={64} defaultValue={editing?.code ?? pendingCreate.current?.code ?? ""} disabled={busy || pendingCreate.current !== null}/></label>
        <label>Nombre<input name="name" required maxLength={200} defaultValue={editing?.name ?? pendingCreate.current?.name ?? ""} disabled={busy || pendingCreate.current !== null}/></label>
        <button disabled={busy}>{editing ? "Guardar cambios" : pendingCreate.current ? "Reintentar creación" : "Crear caja"}</button>
        {editing && <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancelar edición</button>}
      </form>
      <table><caption>Cajas de la sucursal seleccionada</caption><thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{registers.map(r => <tr key={r.id}><td>{r.code}</td><td>{r.name}</td><td>{r.status === "ACTIVE" ? "Activa" : "Retirada"}</td><td>
          <button disabled={busy || pendingCreate.current !== null || r.status !== "ACTIVE"} onClick={() => setEditing(r)}>Editar {r.code}</button>
          <button disabled={busy || pendingCreate.current !== null || r.status !== "ACTIVE"} onClick={() => void run(async () => {
            await client.retire({ companyId: current.companyId, branchId: current.branchId, licenseId: current.licenseId }, r); await load(current); setNotice("Caja retirada; historia conservada.");
          })}>Retirar {r.code}</button></td></tr>)}</tbody></table>
      <button disabled={busy || !nextCursor} onClick={() => void run(() => load(current, nextCursor))}>Siguiente página</button>
    </>}
    <button disabled={busy} onClick={() => void run(async () => { await client.logout(); setAuthenticated(false); setContexts([]); setRegisters([]); setSelected(""); setNotice("Central confirmó el cierre."); })}>Cerrar sesión BUSINESS</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
