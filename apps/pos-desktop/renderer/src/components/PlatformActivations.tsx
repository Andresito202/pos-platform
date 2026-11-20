import { useEffect, useRef, useState } from "react";
import { uuidV7, type LicenseActivationSummary } from "@pos-platform/contracts";
import type { PlatformClient } from "../platform-client.js";

const labels = { PENDING: "Pendiente de activación", ACTIVE: "Activa", REVOKED: "Revocada en Central" };
export function PlatformActivations({ client }: { client: PlatformClient }): React.JSX.Element {
  const [rows, setRows] = useState<LicenseActivationSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<LicenseActivationSummary | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const running = useRef(false), alive = useRef(true);
  async function load(after: string | null = null) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      const page = await client.activations(after);
      if (!alive.current) return;
      setRows(current => after === null ? page.activations : [...current, ...page.activations.filter(row => !current.some(old => old.activationId === row.activationId))]);
      setNext(page.nextCursor); setLoaded(true);
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : "No se pudo consultar Central."); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [client]);
  async function revoke() {
    if (!selected || !confirmed || running.current) return;
    running.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      await client.revokeActivation(selected.activationId, uuidV7());
      if (!alive.current) return;
      setRows(current => current.map(row => row.activationId === selected.activationId ? { ...row, status: "REVOKED" } : row));
      setSelected(null); setConfirmed(false);
      setNotice("Central confirmó la revocación. El bloqueo local requiere que el dispositivo reciba la revocación firmada; una caja desconectada no se bloquea inmediatamente.");
    } catch (failure) { if (alive.current) setError(`${failure instanceof Error ? failure.message : "No se recibió confirmación."} Actualiza la lista para comprobar el resultado.`); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="pos-admin-surface" aria-label="Activaciones de licencias">
    <header className="pos-admin-header"><div><h3>Licencias por dispositivo</h3><p>Activaciones registradas en Central. La revocación afecta a la activación seleccionada y no cancela el contrato de toda la empresa.</p></div>
      <button type="button" disabled={busy} onClick={() => { setSelected(null); setConfirmed(false); void load(); }}>Actualizar activaciones</button></header>
    {busy && <p role="status">Consultando Central…</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loaded && rows.length === 0 && !error && <p>No hay activaciones registradas.</p>}
    {rows.length > 0 && <div className="pos-table-scroll"><table className="pos-data-table"><caption>Activaciones consultadas: {rows.length}</caption>
      <thead><tr><th>Empresa / licencia</th><th>Dispositivo / activación</th><th>Estado</th><th>Acción</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.activationId}><td>{row.companyId}<br /><small>{row.licenseId}</small></td>
        <td>{row.deviceId}<br /><small>{row.activationId}</small></td><td>{labels[row.status]}</td>
        <td><button type="button" disabled={busy || row.status !== "ACTIVE"} onClick={() => { setSelected(row); setConfirmed(false); setNotice(null); }}>Revocar activación</button></td></tr>)}</tbody>
    </table></div>}
    {next && <button type="button" disabled={busy} onClick={() => void load(next)}>Cargar más activaciones</button>}
    {selected && <section className="pos-admin-empty" aria-label="Confirmación de revocación"><h4>Revocar acceso del dispositivo</h4>
      <p>Dispositivo: {selected.deviceId}. Activación: {selected.activationId}.</p>
      <p>Esta acción no se deshace desde este panel y no libera automáticamente cupos para otra caja.</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />Confirmo la revocación de esta activación</label>
      <button type="button" disabled={busy || !confirmed} onClick={() => void revoke()}>Confirmar revocación en Central</button>
      <button type="button" disabled={busy} onClick={() => { setSelected(null); setConfirmed(false); }}>Cancelar</button>
    </section>}
  </section>;
}
