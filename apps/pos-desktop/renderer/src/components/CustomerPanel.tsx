import { CanonicalPermission, UuidSchema } from "@pos-platform/contracts";
import { useState } from "react";
import { useCustomerDirectory } from "../hooks/useCustomerDirectory.js";

/**
 * Adquiriente: alta y búsqueda.
 *
 * `findings` se muestra entero cuando el alta se rechaza. Un rechazo fiscal sin
 * decir qué campo falla obliga a probar a ciegas, y probar a ciegas contra una
 * tabla DIAN es como no tener la tabla.
 */
export function CustomerPanel({ permissions }: {
  readonly permissions: ReadonlySet<string>;
}): React.JSX.Element {
  const canRegister = permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER);
  const canRead = permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_READ);
  const directory = useCustomerDirectory();
  const [documentCode, setDocumentCode] = useState("");
  const [identification, setIdentification] = useState("");
  const [verificationDigit, setVerificationDigit] = useState("");
  const [legalOrganizationCode, setLegalOrganizationCode] = useState("");
  const [company, setCompany] = useState("");
  const [names, setNames] = useState("");
  const [tributeCode, setTributeCode] = useState("");
  const [responsibilities, setResponsibilities] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [customerId, setCustomerId] = useState("");

  const incomplete = documentCode.trim() === ""
    || identification.trim() === ""
    || legalOrganizationCode.trim() === ""
    || tributeCode.trim() === "";

  const parsedId = UuidSchema.safeParse(customerId.trim().toLowerCase());

  return (
    <section className="pos-customer-panel" data-testid="customer-panel" aria-busy={directory.busy}>
      <h2>Adquirientes</h2>

      <div className="pos-customer-fields">
        <input
          data-testid="customer-document-code-input"
          value={documentCode}
          onChange={(e) => { setDocumentCode(e.target.value); }}
          aria-label="Código DIAN del documento"
          placeholder="Código DIAN del documento"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-identification-input"
          value={identification}
          onChange={(e) => { setIdentification(e.target.value); }}
          aria-label="Identificación"
          placeholder="Identificación"
          disabled={directory.busy}
        />
        {canRegister && <>
          <input
            data-testid="customer-verification-digit-input"
            value={verificationDigit}
            onChange={(e) => { setVerificationDigit(e.target.value); }}
            aria-label="DV (opcional)"
            placeholder="DV (opcional)"
            disabled={directory.busy}
          />
          <input
            data-testid="customer-legal-organization-input"
            value={legalOrganizationCode}
            onChange={(e) => { setLegalOrganizationCode(e.target.value); }}
            aria-label="Código de organización legal"
            placeholder="Código de organización legal"
            disabled={directory.busy}
          />
          <input
            data-testid="customer-company-input"
            value={company}
            onChange={(e) => { setCompany(e.target.value); }}
            aria-label="Razón social (persona jurídica)"
            placeholder="Razón social (persona jurídica)"
            disabled={directory.busy}
          />
          <input
            data-testid="customer-names-input"
            value={names}
            onChange={(e) => { setNames(e.target.value); }}
            aria-label="Nombres (persona natural)"
            placeholder="Nombres (persona natural)"
            disabled={directory.busy}
          />
          <input
            data-testid="customer-tribute-input"
            value={tributeCode}
            onChange={(e) => { setTributeCode(e.target.value); }}
            aria-label="Código de tributo"
            placeholder="Código de tributo"
            disabled={directory.busy}
          />
          {/* Lista separada por comas: es un array en el contrato y no se colapsa a
              un solo código, porque un responsable puede tener varios. */}
          <input
            data-testid="customer-responsibilities-input"
            value={responsibilities}
            onChange={(e) => { setResponsibilities(e.target.value); }}
            aria-label="Responsabilidades fiscales, separadas por coma"
            placeholder="Responsabilidades fiscales, separadas por coma"
            disabled={directory.busy}
          />
          <input
            data-testid="customer-email-input"
            value={email}
            onChange={(e) => { setEmail(e.target.value); }}
            aria-label="Correo (opcional)"
            placeholder="Correo (opcional)"
            disabled={directory.busy}
          />
          <input
            data-testid="customer-phone-input"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); }}
            aria-label="Teléfono (opcional)"
            placeholder="Teléfono (opcional)"
            disabled={directory.busy}
          />
        </>}
      </div>
      {canRegister && (
        <button
          data-testid="register-customer-button"
          onClick={() => {
            void directory.register({
              identificationDocumentCode: documentCode.trim(),
              identification: identification.trim(),
              verificationDigit,
              legalOrganizationCode: legalOrganizationCode.trim(),
              company,
              names,
              tributeCode: tributeCode.trim(),
              fiscalResponsibilityCodes: responsibilities
                .split(",")
                .map((code) => code.trim())
                .filter((code) => code !== ""),
              email,
              phone,
            });
          }}
          disabled={directory.busy || incomplete}
        >
          Registrar adquiriente
        </button>
      )}

      {canRead && <>
        <button
          data-testid="find-customer-button"
          onClick={() => { void directory.find(documentCode.trim(), identification.trim()); }}
          disabled={directory.busy || documentCode.trim() === "" || identification.trim() === ""}
        >
          Buscar
        </button>

        <input
          data-testid="customer-id-input"
          aria-describedby={customerId.trim() !== "" && !parsedId.success ? "customer-id-help" : undefined}
          value={customerId}
          onChange={(e) => { setCustomerId(e.target.value); }}
          aria-label="ID del adquiriente"
          placeholder="ID del adquiriente"
          disabled={directory.busy}
        />
        <button
          data-testid="get-customer-button"
          onClick={() => { if (parsedId.success) void directory.get(parsedId.data); }}
          disabled={directory.busy || !parsedId.success}
        >
          Consultar por ID
        </button>
        {customerId.trim() !== "" && !parsedId.success && (
          <p id="customer-id-help">Introduce un ID de adquiriente válido para consultar.</p>
        )}
      </>}
      {directory.busy && <p role="status">Procesando solicitud…</p>}

      {canRegister && directory.registered !== null && directory.registered.customer_id !== null && (
        <div data-testid="customer-registered" role="status">
          <p>{directory.registered.outcome === "IDENTITY_ALREADY_REGISTERED"
            ? "El adquiriente ya está registrado." : "Adquiriente guardado."}</p>
          <dl className="pos-customer-details">
            <dt>ID del adquiriente</dt>
            <dd className="pos-customer-identifier" data-testid="customer-registered-id">{directory.registered.customer_id}</dd>
            <dt>Versión</dt>
            <dd data-testid="customer-registered-version">{directory.registered.version}</dd>
          </dl>
        </div>
      )}
      {canRegister && directory.registered !== null && directory.registered.customer_id === null && (
        <div data-testid="customer-rejected" role="alert">
          <p>{directory.registered.outcome === "UNAUTHORIZED" ? "El registro no está autorizado."
            : "El registro no se pudo guardar."}</p>
          <span data-testid="customer-rejected-outcome">{directory.registered.outcome}</span>
          {directory.registered.findings.map((finding, index) => (
            <span key={`${String(index)}`} data-testid="customer-finding">
              {finding.path} · {finding.code}
            </span>
          ))}
        </div>
      )}

      {canRead && directory.found !== null && directory.found.outcome === "FOUND" && (
        <div data-testid="customer-found" role="status">
          <p data-testid="customer-found-name">{directory.found.company ?? directory.found.names ?? "Adquiriente"}</p>
          <dl className="pos-customer-details">
            <dt>Identificación</dt>
            <dd data-testid="customer-found-identification">{directory.found.identification}</dd>
            <dt>Tributo</dt>
            <dd data-testid="customer-found-tribute">{directory.found.tribute_code}</dd>
            <dt>ID del adquiriente</dt>
            <dd className="pos-customer-identifier" data-testid="customer-found-id">{directory.found.customer_id}</dd>
          </dl>
        </div>
      )}
      {canRead && directory.found !== null && directory.found.outcome === "NOT_FOUND" && (
        <p data-testid="customer-not-found" role="status">El adquiriente no está registrado.</p>
      )}
      {canRead && directory.found?.outcome === "UNAUTHORIZED" && <p role="alert">La consulta no está autorizada.</p>}
      {directory.error !== null && <div role="alert" data-testid="customer-error">{directory.error}</div>}
    </section>
  );
}
