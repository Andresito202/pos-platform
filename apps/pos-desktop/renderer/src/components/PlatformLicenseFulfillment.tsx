import { useRef, useState } from "react";
import { LicenseAllocationRequestSchema, UuidSchema, uuidV7 } from "@pos-platform/contracts";
import { PlatformRequestError, type PlatformClient } from "../platform-client.js";

type Allocation = ReturnType<typeof LicenseAllocationRequestSchema.parse>;
export function PlatformLicenseFulfillment({ client }: { client: PlatformClient }): React.JSX.Element {
  const [payment, setPayment] = useState("");
  const [license, setLicense] = useState("");
  const [credential, setCredential] = useState("");
  const [registers, setRegisters] = useState([{ branch: "", register: "" }]);
  const [draft, setDraft] = useState<Allocation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Awaited<ReturnType<PlatformClient["issueLicense"]>> | null>(null);
  const [allocated, setAllocated] = useState<Awaited<ReturnType<PlatformClient["allocateLicense"]>> | null>(null);
  const lock = useRef(false);
  const attempts = useRef(new Map<string, Allocation>());
  async function issue() {
    if (lock.current) return;
    const id = UuidSchema.safeParse(payment.trim());
    if (!id.success) { setError("Introduce el identificador válido del pago confirmado en Central."); return; }
    lock.current = true; setBusy(true); setError(null); setIssued(null);
    try { const result = await client.issueLicense(id.data, uuidV7()); setIssued(result); if (!draft) setLicense(result.licenseId); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "No se confirmó la emisión. Reintenta con el mismo pago."); }
    finally { lock.current = false; setBusy(false); }
  }
  function prepare() {
    setError(null); setAllocated(null); setConfirmed(false);
    const candidate = LicenseAllocationRequestSchema.safeParse({ license_id: license.trim(), credential_id: credential.trim(),
      allocations: registers.map(row => ({ branch_id: row.branch.trim(), register_id: row.register.trim() })), idempotency_key: uuidV7(), correlation_id: uuidV7() });
    if (!candidate.success) { setError("Revisa licencia, credencial, sucursales y cajas. Todos deben tener identificadores válidos y no puedes repetir una caja."); return; }
    // Same semantic request retains its identity across edits/reviews in this panel.
    candidate.data.allocations.sort((a, b) => a.register_id.localeCompare(b.register_id));
    const identity = JSON.stringify([candidate.data.license_id, candidate.data.credential_id, candidate.data.allocations]);
    const saved = attempts.current.get(identity) ?? candidate.data;
    attempts.current.set(identity, saved); setDraft(saved);
  }
  async function allocate() {
    if (!draft || !confirmed || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { setAllocated(await client.allocateLicense(draft)); setUncertain(false); }
    catch (failure) {
      const rejected = failure instanceof PlatformRequestError && [400,401,403,409,413,415,429].includes(failure.status);
      setUncertain(!rejected);
      setError(`${failure instanceof Error ? failure.message : "No se confirmó la asignación."}${rejected ? " Puedes corregir los datos tras el rechazo de Central." : " No cambies los datos: reintenta la misma solicitud para conocer el resultado."}`);
    }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="pos-admin-surface" aria-label="Emisión y asignación de licencias">
    <h3>Emitir licencia y asignar cajas</h3>
    <p>Central valida el pago de suscripción, las políticas comerciales, la credencial del dispositivo y los cupos pagados. Estos formularios no cobran ni registran pagos manuales.</p>
    <form onSubmit={event => { event.preventDefault(); void issue(); }}>
      <label className="pos-field">Pago confirmado<input aria-label="Pago confirmado" value={payment} maxLength={36} disabled={busy} onChange={event => { setPayment(event.target.value); setIssued(null); }} required /></label>
      <button type="submit" disabled={busy || !payment.trim()}>Emitir o recuperar licencia del pago</button>
    </form>
    {issued && <p role="status">Licencia: {issued.licenseId}. Estado contractual: {issued.contractStatus}. {issued.idempotent ? "Contrato existente recuperado." : "Contrato emitido."} La activación del dispositivo se consulta por separado.</p>}
    <h4>Asignación al dispositivo</h4>
    <p>Usa los identificadores registrados en Central. La credencial corresponde al dispositivo aprovisionado; no es una contraseña ni una clave privada.</p>
    <fieldset disabled={busy || draft !== null} className="pos-form-grid"><legend>Licencia, dispositivo y cajas</legend>
      <label className="pos-field">Licencia<input aria-label="Licencia a asignar" value={license} maxLength={36} onChange={event => setLicense(event.target.value)} /></label>
      <label className="pos-field">Credencial del dispositivo<input aria-label="Credencial del dispositivo" value={credential} maxLength={36} onChange={event => setCredential(event.target.value)} /></label>
      {registers.map((row, index) => <div key={index} className="pos-form-grid">
        <label className="pos-field">Sucursal {index + 1}<input aria-label={`Sucursal ${index + 1}`} value={row.branch} maxLength={36} onChange={event => setRegisters(current => current.map((item, at) => at === index ? { ...item, branch: event.target.value } : item))} /></label>
        <label className="pos-field">Caja {index + 1}<input aria-label={`Caja ${index + 1}`} value={row.register} maxLength={36} onChange={event => setRegisters(current => current.map((item, at) => at === index ? { ...item, register: event.target.value } : item))} /></label>
        <button type="button" disabled={registers.length === 1} onClick={() => setRegisters(current => current.filter((_, at) => at !== index))}>Quitar caja {index + 1}</button>
      </div>)}
      <button type="button" disabled={registers.length >= 100} onClick={() => setRegisters(current => [...current, { branch: "", register: "" }])}>Añadir caja</button>
      <button type="button" onClick={prepare}>Revisar asignación</button>
    </fieldset>
    {draft && <section aria-label="Revisión de asignación"><h4>Confirmar asignación</h4>
      <p>Licencia {draft.license_id} · credencial {draft.credential_id} · {draft.allocations.length} cajas solicitadas.</p>
      <p>Referencia de solicitud: {draft.idempotency_key}. Ante una respuesta incierta, conserva esta pantalla y reintenta la misma solicitud.</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy || allocated !== null} onChange={event => setConfirmed(event.target.checked)} />Confirmo las cajas y el dispositivo seleccionados</label>
      <button type="button" disabled={busy || !confirmed || allocated !== null} onClick={() => void allocate()}>Confirmar asignación en Central</button>
      <button type="button" disabled={busy || uncertain} onClick={() => { setDraft(null); setConfirmed(false); setAllocated(null); }}>Volver a los datos</button>
    </section>}
    {allocated && <p role="status">Activación: {allocated.activationId}. Estado confirmado por Central: {allocated.status}. {allocated.status === "PENDING" ? "El dispositivo aún debe acreditar posesión y descargar la autorización firmada." : "No se modifica el estado informado por Central."}</p>}
    {busy && <p role="status">Procesando en Central…</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
