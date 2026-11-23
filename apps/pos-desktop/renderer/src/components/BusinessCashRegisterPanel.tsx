import { useEffect, useRef, useState } from "react";
import { uuidV7, type CashRegisterMasterRow, type BusinessContextsSchema, type CashRegisterCreateRequest } from "@pos-platform/contracts";
import type * as z from "zod";
import { BusinessClient, BusinessHttpRejection } from "../business-client.js";

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
  if (!authenticated) return <section className="pos-admin-panel" aria-label="Acceso administrativo">
    <header className="pos-admin-header">
      <div>
        <span className="pos-admin-eyebrow">ADMINISTRACIÓN</span>
        <h2>Administración de cajas</h2>
        <p>Inicia sesión con tu cuenta empresarial y el autenticador. Usa los datos de organización y membresía entregados con tu alta.</p>
      </div>
    </header>
    <form className="pos-form-grid" onSubmit={e => { e.preventDefault(); const f = e.currentTarget, data = new FormData(f);
      const password = String(data.get("password")); (f.elements.namedItem("password") as HTMLInputElement).value = "";
      void run(async () => { controller.current = new AbortController();
        await client.login(String(data.get("email")), password, String(data.get("tenant")), String(data.get("membership")), controller.current.signal);
        setAuthenticated(true); const result = await client.contexts(); setContexts(result.contexts);
        const pending = pendingCreate.current;
        if (pending) {
          const index = result.contexts.findIndex(c => c.companyId === pending.companyId && c.branchId === pending.branchId && c.licenseId === pending.licenseId);
          if (index >= 0) { setSelected(String(index)); await load(result.contexts[index]!); }
          else setNotice("Hay una creación pendiente en otra empresa o sucursal. Inicia sesión con la cuenta autorizada para continuarla.");
        }
        if (result.truncated) setNotice("Se muestran los primeros 100 ámbitos autorizados.");
      }); }}>
      <label>Correo<input name="email" type="email" autoComplete="username" required maxLength={320} disabled={busy}/></label>
      <label>Contraseña<input name="password" type="password" autoComplete="current-password" required maxLength={1024} disabled={busy}/></label>
      <label>Organización<input name="tenant" required maxLength={36} disabled={busy}/></label>
      <label>Membresía<input name="membership" required maxLength={36} disabled={busy}/></label>
      <div className="pos-admin-audit-actions">
        <button disabled={busy}>Ingresar con autenticador</button>
        <button type="button" disabled={!busy} onClick={() => controller.current?.abort()}>Cancelar</button>
      </div>
    </form>{error && <p role="alert">{error}</p>}
  </section>;
  return <section className="pos-admin-panel" aria-label="Administración de cajas" aria-busy={busy}>
    <header className="pos-admin-header">
      <div>
        <span className="pos-admin-eyebrow">ADMINISTRACIÓN</span>
        <h2>Administración de cajas</h2>
        <p>Al retirar una caja se conserva su historial. Liberar una licencia asignada requiere el procedimiento correspondiente.</p>
      </div>
      <button disabled={busy} onClick={() => void run(async () => { await client.logout(); setAuthenticated(false); setContexts([]); setRegisters([]); setSelected(""); setNotice("Sesión cerrada correctamente."); })}>Cerrar sesión</button>
    </header>
    <label className="pos-admin-scope-select">Empresa, sucursal y licencia<select value={selected} disabled={busy || pendingCreate.current !== null} onChange={e => {
      setSelected(e.target.value); setRegisters([]); setEditing(null); setNextCursor(null);
      const context = contexts[Number(e.target.value)]; if (context && e.target.value !== "") void run(() => load(context));
    }}><option value="">Selecciona un ámbito</option>{contexts.map((c, i) => <option key={`${c.companyId}/${c.branchId}/${c.licenseId}`} value={i}>{c.companyName} · {c.branchName} · {c.licenseName} · Licencia {c.licenseId}</option>)}</select></label>
    {contexts.length === 0 && <div className="pos-admin-empty" role="status"><span>No hay ámbitos con permiso de administrar cajas y licencia comercial disponible.</span></div>}
    <div className="pos-admin-audit-actions">
      <button disabled={busy || selected === ""} onClick={() => current && void run(() => load(current))}>Actualizar cajas</button>
    </div>
    {selected !== "" && current && <>
      <form className="pos-admin-surface pos-form-grid" key={`${selected}/${editing?.id ?? createId}/${editing?.version ?? 0}`} onSubmit={e => {
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
            try {
              await client.create(scope, { id: request.id, code: request.code, name: request.name, currency: request.currency, correlationId: request.correlationId });
            } catch(e) {
              // A first-attempt definitive rejection made no mutation. If an
              // earlier reply was uncertain, later 4xx cannot disprove its commit.
              if(!pending && e instanceof BusinessHttpRejection && e.definitive) pendingCreate.current=null;
              throw e;
            }
            pendingCreate.current = null;
          }
          setCreateId(uuidV7()); await load(current); form.reset(); setNotice("Operación confirmada."); });
      }}>
        <h3>{editing ? "Editar caja" : "Crear caja"}</h3>
        <input type="hidden" name="id" value={editing?.id ?? createId}/>
        <label>Código<input name="code" required maxLength={64} defaultValue={editing?.code ?? pendingCreate.current?.code ?? ""} disabled={busy || pendingCreate.current !== null}/></label>
        <label>Nombre<input name="name" required maxLength={200} defaultValue={editing?.name ?? pendingCreate.current?.name ?? ""} disabled={busy || pendingCreate.current !== null}/></label>
        <div className="pos-admin-audit-actions">
          <button disabled={busy}>{editing ? "Guardar cambios" : pendingCreate.current ? "Reintentar creación" : "Crear caja"}</button>
          {editing && <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancelar edición</button>}
        </div>
      </form>
      <div className="pos-admin-audit-table">
        <table><caption>Cajas de la sucursal seleccionada</caption><thead><tr><th>Código</th><th>Nombre</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{registers.map(r => <tr key={r.id}><td>{r.code}</td><td>{r.name}</td><td>{r.status === "ACTIVE" ? "Activa" : "Retirada"}</td><td>
            <button disabled={busy || pendingCreate.current !== null || r.status !== "ACTIVE"} onClick={() => setEditing(r)}>Editar {r.code}</button>
            <button className="pos-danger-action" disabled={busy || pendingCreate.current !== null || r.status !== "ACTIVE"} onClick={() => void run(async () => {
            await client.retire({ companyId: current.companyId, branchId: current.branchId, licenseId: current.licenseId }, r); await load(current); setNotice("Caja retirada. El historial se conserva.");
          })}>Retirar {r.code}</button></td></tr>)}</tbody></table>
      </div>
      <button disabled={busy || !nextCursor} onClick={() => void run(() => load(current, nextCursor))}>Siguiente página</button>
    </>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
