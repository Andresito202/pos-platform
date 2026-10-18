import { CanonicalPermission } from "@pos-platform/contracts";
import { useState } from "react";
import { useCustomerDirectory } from "../hooks/useCustomerDirectory.js";

/**
 * Adquiriente: alta y búsqueda.
 *
 * `findings` se muestra entero cuando el alta se rechaza. Un rechazo fiscal sin
 * decir qué campo falla obliga a probar a ciegas, y probar a ciegas contra una
 * tabla DIAN es como no tener la tabla.
 */
export function CustomerPanel({ permissions }: { permissions: ReadonlySet<string> }): React.JSX.Element {
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
  const [subscribeToNews, setSubscribeToNews] = useState(false);

  const incomplete = documentCode.trim() === ""
    || identification.trim() === ""
    || legalOrganizationCode.trim() === ""
    || tributeCode.trim() === "";

  return (
    <section data-testid="customer-panel" className="pos-customer-panel">
      <h2>Adquiriente</h2>

      <div className="pos-privacy-notice" data-testid="customer-privacy-notice">
        <h3>Privacidad y tratamiento de datos</h3>
        <p>
          Los datos solicitados se utilizan para identificar al adquiriente y
          gestionar operaciones comerciales y fiscales del POS, según corresponda.
          El correo para consultas de privacidad y solicitudes sobre datos personales
          es <a href="mailto:andrescamacho.19@hotmail.com">andrescamacho.19@hotmail.com</a>.
        </p>
        <details data-testid="customer-privacy-details">
          <summary>Consultar el aviso de privacidad</summary>
          <div className="pos-privacy-details-content">
            <p><strong>Responsable indicado en el borrador:</strong> CamachoPosColombia SAS.</p>
            <p><strong>Contacto:</strong> Transversal 3A #87B-45 Sur, Bogotá D.C., Colombia; teléfono 3227506213; correo andrescamacho.19@hotmail.com.</p>
            <p>
              <strong>Finalidades:</strong> operar el POS; gestionar datos de clientes y
              documentos fiscales cuando corresponda; administrar usuarios, dispositivos
              y seguridad; mantener trazabilidad cuando exista una finalidad legítima;
              y atender consultas y reclamos.
            </p>
            <p>
              <strong>Comunicaciones comerciales:</strong> son opcionales y requieren
              autorización separada. Registrar un adquiriente no equivale a suscribirse.
              La autorización puede retirarse mediante la opción de baja disponible en
              la ficha del adquiriente. El registro de preferencia no significa que el
              envío de campañas esté habilitado.
            </p>
            <p>
              <strong>Derechos y solicitudes:</strong> puede consultar, actualizar o
              solicitar la rectificación o supresión de sus datos, y presentar consultas
              o reclamos a través del correo de privacidad indicado. La supresión puede
              estar limitada cuando exista un deber legal de conservación.
            </p>
            <p>
              <strong>Estado del documento:</strong> este aviso resume el borrador
              documentado en el repositorio. La política definitiva está pendiente de
              formalización del Responsable y de completar su identificación tributaria;
              no debe interpretarse como una política legal definitiva.
            </p>
          </div>
        </details>
      </div>

      <div className="pos-customer-fields">
        <input
          data-testid="customer-document-code-input"
          aria-label="Código DIAN del documento"
          value={documentCode}
          onChange={(e) => { setDocumentCode(e.target.value); }}
          placeholder="Código DIAN del documento"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-identification-input"
          aria-label="Identificación del adquiriente"
          value={identification}
          onChange={(e) => { setIdentification(e.target.value); }}
          placeholder="Identificación"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-verification-digit-input"
          aria-label="Dígito de verificación"
          value={verificationDigit}
          onChange={(e) => { setVerificationDigit(e.target.value); }}
          placeholder="DV (opcional)"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-legal-organization-input"
          aria-label="Código de organización legal"
          value={legalOrganizationCode}
          onChange={(e) => { setLegalOrganizationCode(e.target.value); }}
          placeholder="Código de organización legal"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-company-input"
          aria-label="Razón social"
          value={company}
          onChange={(e) => { setCompany(e.target.value); }}
          placeholder="Razón social (persona jurídica)"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-names-input"
          aria-label="Nombres"
          value={names}
          onChange={(e) => { setNames(e.target.value); }}
          placeholder="Nombres (persona natural)"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-tribute-input"
          aria-label="Código de tributo"
          value={tributeCode}
          onChange={(e) => { setTributeCode(e.target.value); }}
          placeholder="Código de tributo"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-responsibilities-input"
          aria-label="Responsabilidades fiscales"
          value={responsibilities}
          onChange={(e) => { setResponsibilities(e.target.value); }}
          placeholder="Responsabilidades fiscales, separadas por coma"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-email-input"
          aria-label="Correo electrónico"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); }}
          placeholder="Correo (opcional)"
          disabled={directory.busy}
        />
        <input
          data-testid="customer-phone-input"
          aria-label="Teléfono"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); }}
          placeholder="Teléfono (opcional)"
          disabled={directory.busy}
        />
      </div>

      <button
        data-testid="register-customer-button"
        type="button"
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
            subscribeToNews,
          });
        }}
        disabled={directory.busy || !permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER) || incomplete}
      >
        Registrar adquiriente
      </button>

      <label className="pos-marketing-opt-in">
        <input
          data-testid="customer-marketing-opt-in"
          type="checkbox"
          checked={subscribeToNews}
          onChange={(e) => { setSubscribeToNews(e.target.checked); }}
          disabled={directory.busy}
        />
        Autorizo recibir por correo novedades del POS y comunicaciones comerciales relacionadas con Camacho POS.
      </label>

      <button
        data-testid="find-customer-button"
        type="button"
        onClick={() => { void directory.find(documentCode.trim(), identification.trim()); }}
        disabled={directory.busy || !permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_READ) || documentCode.trim() === "" || identification.trim() === ""}
      >
        Buscar
      </button>

      <input
        data-testid="customer-id-input"
        aria-label="ID del adquiriente"
        value={customerId}
        onChange={(e) => { setCustomerId(e.target.value); }}
        placeholder="ID del adquiriente"
        disabled={directory.busy}
      />
      <button
        data-testid="get-customer-button"
        type="button"
        onClick={() => { void directory.get(customerId.trim()); }}
        disabled={directory.busy || !permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_READ) || customerId.trim() === ""}
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

      {directory.found !== null && directory.found.outcome === "FOUND" && (
        <section data-testid="customer-marketing">
          <h3>Novedades del POS</h3>
          <button
            data-testid="customer-marketing-get-button"
            type="button"
            onClick={() => { void directory.getMarketing(directory.found?.customer_id ?? ""); }}
            disabled={directory.busy || !permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_READ) || directory.found.customer_id === null}
          >
            Consultar suscripción
          </button>
          {directory.marketing?.status === "SUBSCRIBED" ? (
            <>
              <p data-testid="customer-marketing-status">Suscrito a novedades por correo.</p>
              <button
                data-testid="customer-marketing-unsubscribe-button"
                type="button"
                onClick={() => { void directory.unsubscribeMarketing(directory.found?.customer_id ?? ""); }}
                disabled={directory.busy || !permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER) || directory.found.customer_id === null}
              >
                Darse de baja
              </button>
            </>
          ) : (
            <>
              <p data-testid="customer-marketing-status">{directory.marketing === null ? "Preferencia pendiente de consulta." : "No suscrito a novedades."}</p>
              <button
                data-testid="customer-marketing-subscribe-button"
                type="button"
                onClick={() => { void directory.subscribeMarketing(directory.found?.customer_id ?? ""); }}
                disabled={directory.busy || !permissions.has(CanonicalPermission.CUSTOMERS_CUSTOMER_REGISTER) || directory.found.customer_id === null || directory.found.email === null}
              >
                Suscribirse
              </button>
            </>
          )}
        </section>
      )}

      {directory.error !== null && <div data-testid="customer-error">{directory.error}</div>}
    </section>
  );
}
