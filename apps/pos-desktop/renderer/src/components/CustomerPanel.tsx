import { useState } from "react";
import { useCustomerDirectory } from "../hooks/useCustomerDirectory.js";

/**
 * Adquiriente: alta y búsqueda.
 *
 * `findings` se muestra entero cuando el alta se rechaza. Un rechazo fiscal sin
 * decir qué campo falla obliga a probar a ciegas, y probar a ciegas contra una
 * tabla DIAN es como no tener la tabla.
 */
export function CustomerPanel(): React.JSX.Element {
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

  return (
    <section className="card" data-testid="customer-panel">
      <h2>Adquiriente</h2>

      <input
        data-testid="customer-document-code-input"
        value={documentCode}
        onChange={(e) => { setDocumentCode(e.target.value); }}
        placeholder="Código DIAN del documento"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-identification-input"
        value={identification}
        onChange={(e) => { setIdentification(e.target.value); }}
        placeholder="Identificación"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-verification-digit-input"
        value={verificationDigit}
        onChange={(e) => { setVerificationDigit(e.target.value); }}
        placeholder="DV (opcional)"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-legal-organization-input"
        value={legalOrganizationCode}
        onChange={(e) => { setLegalOrganizationCode(e.target.value); }}
        placeholder="Código de organización legal"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-company-input"
        value={company}
        onChange={(e) => { setCompany(e.target.value); }}
        placeholder="Razón social (persona jurídica)"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-names-input"
        value={names}
        onChange={(e) => { setNames(e.target.value); }}
        placeholder="Nombres (persona natural)"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-tribute-input"
        value={tributeCode}
        onChange={(e) => { setTributeCode(e.target.value); }}
        placeholder="Código de tributo"
        disabled={directory.busy}
      />
      {/* Lista separada por comas: es un array en el contrato y no se colapsa a
          un solo código, porque un responsable puede tener varios. */}
      <input
        data-testid="customer-responsibilities-input"
        value={responsibilities}
        onChange={(e) => { setResponsibilities(e.target.value); }}
        placeholder="Responsabilidades fiscales, separadas por coma"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-email-input"
        value={email}
        onChange={(e) => { setEmail(e.target.value); }}
        placeholder="Correo (opcional)"
        disabled={directory.busy}
      />
      <input
        data-testid="customer-phone-input"
        value={phone}
        onChange={(e) => { setPhone(e.target.value); }}
        placeholder="Teléfono (opcional)"
        disabled={directory.busy}
      />

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

      <button
        data-testid="find-customer-button"
        onClick={() => { void directory.find(documentCode.trim(), identification.trim()); }}
        disabled={directory.busy || documentCode.trim() === "" || identification.trim() === ""}
      >
        Buscar
      </button>

      <input
        data-testid="customer-id-input"
        value={customerId}
        onChange={(e) => { setCustomerId(e.target.value); }}
        placeholder="ID del adquiriente"
        disabled={directory.busy}
      />
      <button
        data-testid="get-customer-button"
        onClick={() => { void directory.get(customerId.trim()); }}
        disabled={directory.busy || customerId.trim() === ""}
      >
        Consultar por ID
      </button>

      {directory.registered !== null && directory.registered.customer_id !== null && (
        <div data-testid="customer-registered">
          <span data-testid="customer-registered-id">{directory.registered.customer_id}</span>
          <span data-testid="customer-registered-outcome">{directory.registered.outcome}</span>
          <span data-testid="customer-registered-version">{directory.registered.version}</span>
        </div>
      )}
      {directory.registered !== null && directory.registered.customer_id === null && (
        <div data-testid="customer-rejected">
          <span data-testid="customer-rejected-outcome">{directory.registered.outcome}</span>
          {directory.registered.findings.map((finding, index) => (
            <span key={`${String(index)}`} data-testid="customer-finding">
              {JSON.stringify(finding)}
            </span>
          ))}
        </div>
      )}

      {directory.found !== null && directory.found.outcome === "FOUND" && (
        <div data-testid="customer-found">
          <span data-testid="customer-found-id">{directory.found.customer_id}</span>
          <span data-testid="customer-found-identification">{directory.found.identification}</span>
          <span data-testid="customer-found-tribute">{directory.found.tribute_code}</span>
        </div>
      )}
      {directory.found !== null && directory.found.outcome === "NOT_FOUND" && (
        <div data-testid="customer-not-found">no está registrado</div>
      )}
      {directory.error !== null && <div data-testid="customer-error">{directory.error}</div>}
    </section>
  );
}
