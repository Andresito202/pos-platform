import { describe, expect, it } from "vitest";
import {
  CashShiftOpenRequestSchema,
  COMMERCIAL_IPC_ELECTRON_CHANNELS,
  CommercialIpcMessageTypeSchema,
  IpcMessageTypeSchema,
  CustomerReadResultSchema,
  CustomerRegisterRequestSchema,
  FiscalDocumentIssueRequestSchema,
  SaleCreateRequestSchema,
  InventoryLotTraceRequestSchema,
  FiscalDocumentListRequestSchema,
  FiscalDocumentListResultSchema,
  FiscalDocumentIssueResultSchema,
  InventoryLotListResultSchema,
  InventoryLotExpiringRequestSchema,
  InventoryLotExpiringResultSchema,
  LotExpiryStateSchema,
  NEAR_EXPIRY_DAYS,
  InventoryLotTraceResultSchema,
  InventoryStockAdjustRequestSchema,
  InventoryStockReceiveRequestSchema,
  PaymentRegisterCashRequestSchema,
  PaymentRegisterTransferRequestSchema,
  OperationConfirmRequestSchema,
  OperationResultRequestSchema,
  RuntimeHandshakeRequestSchema,
  RuntimeStatusRequestSchema,
} from "../src/index.js";

const metadata = {
  protocol_version: "1.0.0",
  request_id: "550e8400-e29b-41d4-a716-446655440000",
  correlation_id: "550e8400-e29b-41d4-a716-446655440001",
  payload_schema_version: "1.0.0",
};

describe("TECH-003 IPC contracts", () => {
  it("allowlists exact runtime status messages", () => {
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "runtime.status.get", payload: {} }).success).toBe(true);
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "shell.execute", payload: {} }).success).toBe(false);
  });
  it("rejects unexpected runtime status payload fields", () => {
    expect(RuntimeStatusRequestSchema.safeParse({ ...metadata, message_type: "runtime.status.get", payload: { shell: true } }).success).toBe(false);
  });
  it("requires both identities when querying an uncertain operation", () => {
    expect(OperationResultRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.result.get",
      payload: { operation_id: "550e8400-e29b-41d4-a716-446655440002", idempotency_key: "sale:create:1" },
    }).success).toBe(true);
    expect(OperationResultRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.result.get",
      payload: { operation_id: "550e8400-e29b-41d4-a716-446655440002" },
    }).success).toBe(false);
  });
  it("accepts a domain-agnostic operation confirmation with idempotency", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      operation_id: "550e8400-e29b-41d4-a716-446655440020",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: { note: "example" } },
    }).success).toBe(true);
  });
  it("requires operation_id alongside idempotency_key for operation.confirm", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: {} },
    }).success).toBe(false);
  });
  it("rejects unexpected operation.confirm payload fields", () => {
    expect(OperationConfirmRequestSchema.safeParse({
      ...metadata,
      message_type: "operation.confirm",
      operation_id: "550e8400-e29b-41d4-a716-446655440020",
      idempotency_key: "generic:confirm:1",
      payload: { operation_type: "RUNTIME_OPERATION_CONFIRMED", payload: {}, shell: true },
    }).success).toBe(false);
  });
  it("wraps the strict handshake snapshot", () => {
    expect(RuntimeHandshakeRequestSchema.safeParse({
      ...metadata,
      message_type: "runtime.handshake",
      payload: {
        desktop_version: "1.4.0", service_version: "1.4.2", protocol_min: "1.2.0", protocol_max: "1.5.0",
        installation_id: "550e8400-e29b-41d4-a716-446655440010",
        device_id: "550e8400-e29b-41d4-a716-446655440011", schema_version: "003", service_state: "READY",
      },
    }).success).toBe(true);
  });
});


/**
 * `D-9` — el adquiriente en la frontera.
 *
 * Estas pruebas fijan una distinción que ya costó un fallo: **un código DIAN no
 * es un `StableCode`**. El esquema de códigos estables exige empezar por
 * mayúscula, y el catálogo de la DIAN es mayoritariamente numérico. Reutilizarlo
 * rechazaba `"31"`, `"13"` y `"1"` en el borde, y sólo se veía al llegar la
 * primera petición real.
 */
describe("customer.register — la frontera del adquiriente", () => {
  const payload = {
    identification_document_code: "31",
    identification: "900123456",
    verification_digit: "7",
    legal_organization_code: "1",
    company: "Comercializadora del Valle S.A.S.",
    names: null,
    tribute_code: "ZZ",
    fiscal_responsibility_codes: ["R-99-PN"],
    email: "facturacion@example.co",
    phone: "6041234567",
    address: "Carrera 4 # 5-6",
    country_code: "CO",
    municipality_code: "05001",
  };

  const request = (overrides: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "customer.register",
    operation_id: "550e8400-e29b-41d4-a716-446655440002",
    idempotency_key: "customer:register:1",
    payload,
    ...overrides,
  });

  it("acepta los códigos DIAN numéricos, que son la mayoría del catálogo", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request()).success).toBe(true);
  });

  it("acepta también los alfanuméricos con guion, como R-99-PN", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, fiscal_responsibility_codes: ["R-99-PN", "ZZ"] },
    })).success).toBe(true);
  });

  /**
   * La documentación de emisión es taxativa: la identificación viaja **sin**
   * dígito de verificación. Que el contrato lo rechace evita que un
   * «900123456-7» llegue siquiera a la capa confiable.
   */
  it("rechaza una identificación con el dígito de verificación pegado", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, identification: "900123456-7" },
    })).success).toBe(false);
  });

  it("rechaza un DV que no sea un solo dígito", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, verification_digit: "77" },
    })).success).toBe(false);
  });

  it("rechaza un campo que no está en el contrato", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      payload: { ...payload, nit: "900123456" },
    })).success).toBe(false);
  });

  /**
   * El renderer transporta intención, nunca identidad. Un payload que afirme
   * quién es el llamador se rechaza en el sobre, no por convención.
   */
  it("rechaza que el llamador afirme identidad", () => {
    expect(CustomerRegisterRequestSchema.safeParse(request({
      actor_type: "USER",
    })).success).toBe(false);
  });

  it("exige clave de idempotencia: registrar un tercero es una operación", () => {
    const { idempotency_key: _omitted, ...withoutKey } = request();
    expect(CustomerRegisterRequestSchema.safeParse(withoutKey).success).toBe(false);
  });
});

/**
 * `fiscal.document.issue` — `DEC-021` F5.
 *
 * El adquiriente viaja por referencia (`customer_id` ya registrado) o por
 * motivo de ausencia declarado; nunca por los campos del adquiriente sueltos
 * en esta petición, porque eso duplicaría `customer.register`.
 */
describe("fiscal.document.issue — la frontera de la emisión", () => {
  const request = (overrides: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "fiscal.document.issue",
    operation_id: "550e8400-e29b-41d4-a716-446655440002",
    idempotency_key: "fiscal:issue:1",
    payload: {
      sale_id: "550e8400-e29b-41d4-a716-446655440030",
      document_type: "SALES_INVOICE",
      customer: { kind: "NOT_IDENTIFIED", reason: "ANONYMOUS_COUNTER_SALE" },
      observation: null,
    },
    ...overrides,
  });

  it("acepta un adquiriente identificado por referencia", () => {
    expect(FiscalDocumentIssueRequestSchema.safeParse(request({
      payload: {
        ...request().payload,
        customer: { kind: "IDENTIFIED", customer_id: "550e8400-e29b-41d4-a716-446655440031" },
      },
    })).success).toBe(true);
  });

  it("acepta un adquiriente ausente con su motivo", () => {
    expect(FiscalDocumentIssueRequestSchema.safeParse(request()).success).toBe(true);
  });

  it("rechaza los campos del adquiriente sueltos en la petición", () => {
    expect(FiscalDocumentIssueRequestSchema.safeParse(request({
      payload: { ...request().payload, customer: { kind: "IDENTIFIED", identification: "900123456" } },
    })).success).toBe(false);
  });

  it("rechaza un motivo de ausencia que no está en el catálogo", () => {
    expect(FiscalDocumentIssueRequestSchema.safeParse(request({
      payload: { ...request().payload, customer: { kind: "NOT_IDENTIFIED", reason: "PORQUE_SI" } },
    })).success).toBe(false);
  });

  it("rechaza que el llamador afirme identidad", () => {
    expect(FiscalDocumentIssueRequestSchema.safeParse(request({ actor_type: "USER" })).success).toBe(false);
  });

  it("exige clave de idempotencia", () => {
    const { idempotency_key: _omitted, ...withoutKey } = request();
    expect(FiscalDocumentIssueRequestSchema.safeParse(withoutKey).success).toBe(false);
  });
});

/**
 * Auditoría del 2026-09-07: **un pago de cero era válido en el contrato**.
 *
 * Comprobado con sonda antes de cambiar nada. En efectivo eso asentaría un
 * movimiento de caja de importe cero —basura en el libro de caja— sin mover la
 * cobertura de la venta, y la caja es justo el módulo que no admite ruido.
 *
 * La regla **no** se extiende a la apertura ni al conteo de cierre: una caja sí
 * se abre sin base y se cuenta vacía. Ahí el cero es un dato legítimo y estas
 * pruebas lo fijan para que nadie lo endurezca por simetría.
 */
describe("importes: dónde el cero es un pago y dónde es un dato", () => {
  const envelope = {
    ...metadata,
    operation_id: "550e8400-e29b-41d4-a716-446655440002",
    idempotency_key: "k:1",
  };
  const SALE = "550e8400-e29b-41d4-a716-446655440003";

  it("un pago en efectivo de cero se rechaza", () => {
    expect(PaymentRegisterCashRequestSchema.safeParse({
      ...envelope, message_type: "payment.register.cash",
      payload: { sale_id: SALE, amount: "0.000000", tendered_amount: null },
    }).success).toBe(false);
  });

  it("un pago en efectivo positivo se acepta", () => {
    expect(PaymentRegisterCashRequestSchema.safeParse({
      ...envelope, message_type: "payment.register.cash",
      payload: { sale_id: SALE, amount: "1000.000000", tendered_amount: null },
    }).success).toBe(true);
  });

  it("un efectivo entregado de cero se rechaza, pero ausente se acepta", () => {
    const conTendered = (tendered: string | null) =>
      PaymentRegisterCashRequestSchema.safeParse({
        ...envelope, message_type: "payment.register.cash",
        payload: { sale_id: SALE, amount: "1000.000000", tendered_amount: tendered },
      }).success;
    expect(conTendered("0.000000")).toBe(false);
    expect(conTendered(null)).toBe(true);
  });

  it("una transferencia de cero se rechaza", () => {
    expect(PaymentRegisterTransferRequestSchema.safeParse({
      ...envelope, message_type: "payment.register.transfer",
      payload: { sale_id: SALE, amount: "0.000000", provider_code: null, provider_reference: null },
    }).success).toBe(false);
  });

  it("abrir la caja con base cero SÍ se acepta: una caja se abre sin base", () => {
    expect(CashShiftOpenRequestSchema.safeParse({
      ...envelope, message_type: "cash.shift.open",
      payload: {
        cash_register_id: "550e8400-e29b-41d4-a716-446655440004",
        opening_amount: "0.000000", business_date: "2026-09-07",
        timezone_id: "America/Bogota", utc_offset_minutes: -300,
      },
    }).success).toBe(true);
  });
});

describe("inventory.stock.* — la frontera del inventario", () => {
  // El override es **sólo del payload**. Mezclarlo con el sobre —`...overrides`
  // al final— sustituía el payload entero por el fragmento y hacía que cada
  // prueba fallara por campos ausentes en vez de por la regla que afirma
  // comprobar: pasaban por la razón equivocada.
  const receive = (payload: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "inventory.stock.receive",
    operation_id: "550e8400-e29b-41d4-a716-446655440010",
    idempotency_key: "inventory:receive:1",
    payload: {
      presentation_id: "550e8400-e29b-41d4-a716-446655440011",
      movement_type: "PURCHASE_RECEIPT",
      quantity: "10.000000",
      reason_code: "SUPPLIER_DELIVERY",
      business_date: "2026-09-07",
      ...payload,
    },
  });

  const adjust = (payload: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "inventory.stock.adjust",
    operation_id: "550e8400-e29b-41d4-a716-446655440012",
    idempotency_key: "inventory:adjust:1",
    payload: {
      presentation_id: "550e8400-e29b-41d4-a716-446655440011",
      movement_type: "ADJUSTMENT_NEGATIVE",
      quantity: "1.000000",
      reason_code: "COUNT_CORRECTION",
      business_date: "2026-09-07",
      ...payload,
    },
  });

  it("acepta una recepción bien formada", () => {
    expect(InventoryStockReceiveRequestSchema.safeParse(receive()).success).toBe(true);
  });

  /**
   * Lo que separa recibir de ajustar no es un campo: son dos mensajes. Un
   * contrato que aceptara `ADJUSTMENT_NEGATIVE` en la recepción dejaría que el
   * permiso de recibir sirviera para restar existencia.
   */
  it("la recepción no admite un tipo de ajuste, ni el ajuste uno de recepción", () => {
    expect(InventoryStockReceiveRequestSchema.safeParse(
      receive({ movement_type: "ADJUSTMENT_NEGATIVE" }),
    ).success).toBe(false);
    expect(InventoryStockAdjustRequestSchema.safeParse(
      adjust({ movement_type: "PURCHASE_RECEIPT" }),
    ).success).toBe(false);
  });

  it("no admite cantidad cero ni negativa: el signo lo da el tipo", () => {
    expect(InventoryStockReceiveRequestSchema.safeParse(
      receive({ quantity: "0.000000" }),
    ).success).toBe(false);
    expect(InventoryStockReceiveRequestSchema.safeParse(
      receive({ quantity: "-1.000000" }),
    ).success).toBe(false);
  });

  it("exige motivo: un movimiento sin motivo no es revisable", () => {
    expect(InventoryStockAdjustRequestSchema.safeParse(
      adjust({ reason_code: "" }),
    ).success).toBe(false);
  });

  it("exige operación idempotente: un reintento no puede descontar dos veces", () => {
    const { operation_id: _omitted, ...withoutOperation } = receive();
    expect(InventoryStockReceiveRequestSchema.safeParse(withoutOperation).success).toBe(false);
  });

  it("no admite campos extra en el payload", () => {
    expect(InventoryStockReceiveRequestSchema.safeParse(
      receive({ branch_id: "550e8400-e29b-41d4-a716-446655440013" }),
    ).success).toBe(false);
  });

  /**
   * El lote es la «selección autorizada» de una **salida** (`UC-INVENTORY-002`
   * §Salidas paso 4); ausente, resuelve FEFO. Desde el 2026-09-26 también
   * vale en `ADJUSTMENT_POSITIVE`: nombra la tanda existente a la que se suma
   * lo que apareció de más (`MIGRATION_030`). Hasta ese día el contrato lo
   * rechazaba, y esta prueba lo fijaba; cambió por requisito del propietario.
   */
  it("el ajuste admite lote en una salida y en un ajuste positivo, y lo admite ausente", () => {
    expect(InventoryStockAdjustRequestSchema.safeParse(
      adjust({ movement_type: "SHRINKAGE", reason_code: "EXPIRED", lot_code: "L-0924" }),
    ).success).toBe(true);
    expect(InventoryStockAdjustRequestSchema.safeParse(adjust()).success).toBe(true);
    expect(InventoryStockAdjustRequestSchema.safeParse(
      adjust({ movement_type: "ADJUSTMENT_POSITIVE", lot_code: "L-0924" }),
    ).success).toBe(true);
    expect(InventoryStockAdjustRequestSchema.safeParse(
      adjust({ movement_type: "ADJUSTMENT_POSITIVE", lot_code: null }),
    ).success).toBe(true);
    expect(InventoryStockAdjustRequestSchema.safeParse(
      adjust({ lot_code: "" }),
    ).success).toBe(false);
    // La recepción sin lote sigue sin aceptar el campo: su vía es `inventory.lot.receive`.
    expect(InventoryStockReceiveRequestSchema.safeParse(
      receive({ lot_code: "L-0924" }),
    ).success).toBe(false);
  });
});

describe("sale.create — la caja es el único selector del turno", () => {
  const payload = (overrides: Record<string, unknown> = {}) => ({
    cash_register_id: "550e8400-e29b-41d4-a716-446655440020",
    channel: "POS_LOCAL",
    business_date: "2026-09-06",
    timezone_id: "America/Bogota",
    utc_offset_minutes: -300,
    document_series: "FS-001",
    currency_code: "COP",
    lines: [{
      product_id: "550e8400-e29b-41d4-a716-446655440021",
      presentation_id: "550e8400-e29b-41d4-a716-446655440022",
      quantity: "1.000000",
    }],
    ...overrides,
  });
  const request = (p: Record<string, unknown>) => ({
    ...metadata,
    message_type: "sale.create",
    operation_id: "550e8400-e29b-41d4-a716-446655440023",
    idempotency_key: "sale:1",
    payload: p,
  });

  it("acepta la caja nombrada por la operación", () => {
    expect(SaleCreateRequestSchema.safeParse(request(payload())).success).toBe(true);
  });

  /**
   * `null` es la venta que no pasa por caja. El esquema lo admite —`DEC-012`
   * §25.2 no obliga a que toda venta tenga turno— y `sales_sales` lo persiste
   * con el par en nulo.
   */
  it("acepta null: hay ventas que no pasan por caja", () => {
    expect(SaleCreateRequestSchema.safeParse(
      request(payload({ cash_register_id: null })),
    ).success).toBe(true);
  });

  /**
   * Nullable **no** es opcional. Omitirlo dejaría que una venta naciera sin que
   * nadie haya decidido si pasa por caja, y el turno quedaría sin resolver por
   * descuido en vez de por decisión.
   */
  it("no admite omitir el campo: la decisión es explícita", () => {
    const { cash_register_id: _omitted, ...sinCaja } = payload();
    expect(SaleCreateRequestSchema.safeParse(request(sinCaja)).success).toBe(false);
  });

  /**
   * El llamador nombra la **caja**, nunca el **turno**: el turno lo resuelve la
   * capa confiable contra `DEC-012` §25.2. Aceptar `cash_shift_id` dejaría que
   * el renderer imputara efectivo a un arqueo que no le corresponde.
   */
  it("no admite que el llamador nombre el turno", () => {
    expect(SaleCreateRequestSchema.safeParse(
      request(payload({ cash_shift_id: "550e8400-e29b-41d4-a716-446655440024" })),
    ).success).toBe(false);
  });
});

/**
 * La simetria entre lo que se deja escribir y lo que se deja leer.
 *
 * Este bloque existe por un defecto real, encontrado por la pantalla del
 * adquiriente contra el servicio de verdad: `CustomerReadResultSchema` validaba
 * los codigos DIAN con `StableCodeSchema`, que exige empezar por mayuscula. Los
 * codigos DIAN reales son numericos —`13` cedula, `31` NIT, `1` y `2` de
 * organizacion legal—, de modo que un adquiriente colombiano corriente se
 * registraba sin problema y **su lectura mataba el socket**: la respuesta no
 * validaba, el servidor destruia la conexion y el llamador veia «local channel
 * socket closed before response».
 *
 * Lo llamativo es que el razonamiento ya estaba escrito en el propio fichero,
 * sobre `DianCodeSchema`, y no se habia aplicado a la respuesta.
 */
describe("customer.find / customer.get — una respuesta no puede ser mas estricta que su peticion", () => {
  const found = (over: Record<string, unknown> = {}) => ({
    outcome: "FOUND" as const,
    customer_id: "550e8400-e29b-41d4-a716-446655440030",
    identification_document_code: "13",
    identification: "1020304050",
    verification_digit: null,
    legal_organization_code: "2",
    company: null,
    names: "Ana Restrepo",
    tribute_code: "ZZ",
    fiscal_responsibility_codes: ["R-99-PN"],
    email: null,
    phone: null,
    address: null,
    country_code: null,
    municipality_code: null,
    version: 1,
    ...over,
  });

  it("acepta la cedula de ciudadania, que es numerica", () => {
    expect(CustomerReadResultSchema.safeParse(found()).success).toBe(true);
  });

  it("acepta el NIT y la naturaleza juridica, que tambien son numericos", () => {
    expect(CustomerReadResultSchema.safeParse(found({
      identification_document_code: "31",
      legal_organization_code: "1",
      verification_digit: "7",
      company: "Comercializadora del Valle S.A.S.",
      names: null,
    })).success).toBe(true);
  });

  it("cada codigo que la peticion admite, la respuesta lo devuelve", () => {
    for (const code of ["13", "31", "1", "2", "ZZ", "R-99-PN", "O-13", "01", "94"]) {
      const registrable = CustomerRegisterRequestSchema.safeParse({
        ...metadata,
        message_type: "customer.register",
        operation_id: "550e8400-e29b-41d4-a716-446655440031",
        idempotency_key: "customer:register:1",
        payload: {
          identification_document_code: code,
          identification: "1020304050",
          verification_digit: null,
          legal_organization_code: "2",
          company: null,
          names: "Ana Restrepo",
          tribute_code: "ZZ",
          fiscal_responsibility_codes: [code],
          email: null,
          phone: null,
          address: null,
          country_code: null,
          municipality_code: null,
        },
      }).success;
      const legible = CustomerReadResultSchema.safeParse(found({
        identification_document_code: code,
        fiscal_responsibility_codes: [code],
      })).success;
      expect([code, registrable, legible]).toEqual([code, registrable, registrable]);
    }
  });

  it("sigue rechazando lo que no tiene forma de codigo DIAN", () => {
    expect(CustomerReadResultSchema.safeParse(found({
      identification_document_code: "codigo en minuscula",
    })).success).toBe(false);
  });
});

/**
 * Las dos listas de tipos de mensaje, comparadas.
 *
 * `IpcMessageTypeSchema` (transporte) y `CommercialIpcMessageTypeSchema`
 * (superficie comercial) enumeran los mismos nombres en dos ficheros, y hasta
 * hoy **nada las comparaba**. Peor: `CommercialIpcMessageTypeSchema` no la
 * consume nadie —medido el 2026-09-22, su unico uso estaba en su propia
 * declaracion—, de modo que una operacion anadida solo ahi queda **fuera del
 * transporte y es inalcanzable**, sin que falle nada.
 *
 * Es la misma forma de envejecer que ya costo dos correcciones esta semana:
 * dos superficies para el mismo dato. Aqui no se pueden fusionar —`ipc.ts`
 * define el transporte y no debe depender de la superficie comercial— asi que
 * se comparan.
 */
describe("el transporte conoce todas las operaciones comerciales", () => {
  it("ninguna operacion comercial se queda fuera de IpcMessageTypeSchema", () => {
    const transporte = new Set<string>(IpcMessageTypeSchema.options);
    const ausentes = CommercialIpcMessageTypeSchema.options
      .filter((type) => !transporte.has(type));

    expect(
      ausentes,
      "estas operaciones estan en el contrato comercial y el transporte no las conoce: "
      + "el canal las rechazaria y ninguna pantalla podria alcanzarlas",
    ).toEqual([]);
  });

  it("los canales de Electron cubren exactamente la superficie comercial", () => {
    const canales = new Set(COMMERCIAL_IPC_ELECTRON_CHANNELS.map((c) => c.replace(/^pos:/, "")));
    const operaciones = new Set<string>(CommercialIpcMessageTypeSchema.options);

    expect([...operaciones].filter((o) => !canales.has(o)), "operaciones sin canal").toEqual([]);
    expect([...canales].filter((c) => !operaciones.has(c)), "canales sin operacion").toEqual([]);
  });
});

/**
 * `inventory.lot.trace` — rastro de un lote para un retiro sanitario.
 *
 * La sucursal la pone el contexto autorizado: el mismo código puede existir en
 * otra sucursal y es otra existencia (`MIGRATION_028`). Un campo extra que
 * intentara nombrarla se rechaza, no se ignora.
 */
describe("inventory.lot.trace", () => {
  const trace = (payload: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "inventory.lot.trace",
    payload: {
      presentation_id: "550e8400-e29b-41d4-a716-446655440011",
      lot_code: "L-0924",
      ...payload,
    },
  });

  it("acepta una consulta por presentación y código, sin operación: es lectura", () => {
    expect(InventoryLotTraceRequestSchema.safeParse(trace()).success).toBe(true);
  });

  it("rechaza un código vacío y una sucursal aportada por el llamador", () => {
    expect(InventoryLotTraceRequestSchema.safeParse(trace({ lot_code: "" })).success).toBe(false);
    expect(InventoryLotTraceRequestSchema.safeParse(
      trace({ branch_id: "550e8400-e29b-41d4-a716-446655440013" }),
    ).success).toBe(false);
  });

  // Un rastro que no dice si está cortado deja a un retiro sin saber que le faltan ventas.
  it("el resultado exige declarar si está truncado", () => {
    const found = {
      outcome: "NOT_FOUND", lot: null, quantity_received: null,
      origin_lot: null, derived_lots: [], inflows: [], outflows: [],
    };
    expect(InventoryLotTraceResultSchema.safeParse(found).success).toBe(false);
    expect(InventoryLotTraceResultSchema.safeParse({ ...found, truncated: false }).success).toBe(true);
  });
});

/**
 * «Próximo a vencer» — decisión del propietario del 2026-09-26: 7 días. El
 * estado existe en el contrato y el umbral viaja en la respuesta de la lista:
 * una respuesta sin él no es válida.
 */
describe("NEAR_EXPIRY", () => {
  it("el contrato conoce el estado y fija el umbral en 7 días", () => {
    expect(LotExpiryStateSchema.options).toEqual(["NO_EXPIRY", "VALID", "NEAR_EXPIRY", "EXPIRED"]);
    expect(NEAR_EXPIRY_DAYS).toBe(7);
  });

  it("la lista de lotes exige declarar el umbral con que derivó el estado", () => {
    const listed = { outcome: "LISTED", lots: [] };
    expect(InventoryLotListResultSchema.safeParse(listed).success).toBe(false);
    expect(InventoryLotListResultSchema.safeParse({ ...listed, near_expiry_days: 7 }).success).toBe(true);
  });
});

/**
 * `inventory.lot.expiring` — lo que vence esta semana en toda la sucursal.
 * Es lectura; la sucursal sale del contexto y no se acepta del llamador. En la
 * respuesta sólo caben las dos situaciones que exigen actuar.
 */
describe("inventory.lot.expiring", () => {
  const request = (payload: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "inventory.lot.expiring",
    payload: { business_date: "2026-09-22", ...payload },
  });

  it("acepta una fecha de negocio y rechaza una sucursal aportada por el llamador", () => {
    expect(InventoryLotExpiringRequestSchema.safeParse(request()).success).toBe(true);
    expect(InventoryLotExpiringRequestSchema.safeParse(
      request({ branch_id: "550e8400-e29b-41d4-a716-446655440013" }),
    ).success).toBe(false);
  });

  it("una tanda vigente no cabe en la respuesta: sólo vencida o por vencer", () => {
    const lot = (expiry_state: string) => ({
      presentation_id: "550e8400-e29b-41d4-a716-446655440011", lot_code: "L-1",
      expiry_date: "2026-09-24", quantity_on_hand: "1.000000", status: "ACTIVE", expiry_state,
    });
    const result = (state: string) => ({
      outcome: "LISTED", near_expiry_days: 7, lots: [lot(state)], truncated: false,
    });
    expect(InventoryLotExpiringResultSchema.safeParse(result("NEAR_EXPIRY")).success).toBe(true);
    expect(InventoryLotExpiringResultSchema.safeParse(result("EXPIRED")).success).toBe(true);
    expect(InventoryLotExpiringResultSchema.safeParse(result("VALID")).success).toBe(false);
  });
});

/**
 * `D-40` — «advertir»: la confirmación es opcional y ausente vale `false`; el
 * resultado declara siempre si hubo diferencia de adquiriente.
 */
describe("fiscal.document.issue — confirmación de adquiriente distinto (D-40)", () => {
  const request = (payload: Record<string, unknown> = {}) => ({
    ...metadata,
    message_type: "fiscal.document.issue",
    operation_id: "550e8400-e29b-41d4-a716-446655440030",
    idempotency_key: "fiscal:issue:1",
    payload: {
      sale_id: "550e8400-e29b-41d4-a716-446655440031",
      document_type: "SALES_INVOICE",
      customer: { kind: "IDENTIFIED", customer_id: "550e8400-e29b-41d4-a716-446655440032" },
      observation: null,
      ...payload,
    },
  });

  it("acepta la petición con y sin confirmación, y sólo un booleano como confirmación", () => {
    expect(FiscalDocumentIssueRequestSchema.safeParse(request()).success).toBe(true);
    expect(FiscalDocumentIssueRequestSchema.safeParse(
      request({ acknowledge_customer_mismatch: true }),
    ).success).toBe(true);
    expect(FiscalDocumentIssueRequestSchema.safeParse(
      request({ acknowledge_customer_mismatch: "si" }),
    ).success).toBe(false);
  });

  it("el resultado exige declarar la diferencia de adquiriente, aunque sea null", () => {
    const blocked = {
      outcome: "BLOCKED", document_id: null, transport_status: null, normalized_result: null,
      cufe: null, issued_prefix: null, issued_number: null, attempt_count: null,
      block_code: "CUSTOMER_MISMATCH", reasons: [],
    };
    expect(FiscalDocumentIssueResultSchema.safeParse(blocked).success).toBe(false);
    expect(FiscalDocumentIssueResultSchema.safeParse({
      ...blocked,
      customer_mismatch: { sale_customer_id: null, requested_customer_id: "550e8400-e29b-41d4-a716-446655440032" },
    }).success).toBe(true);
  });
});

/**
 * `fiscal.document.list` — a quién se facturó cada documento de una venta. Un
 * documento anterior a `MIGRATION_031` es `NOT_RECORDED`, no anónimo; y un
 * `IDENTIFIED` sin su cliente no es un resultado válido.
 */
describe("fiscal.document.list", () => {
  it("es lectura por venta y no acepta una sucursal del llamador", () => {
    const request = (payload: Record<string, unknown>) => ({
      ...metadata, message_type: "fiscal.document.list", payload,
    });
    expect(FiscalDocumentListRequestSchema.safeParse(
      request({ sale_id: "550e8400-e29b-41d4-a716-446655440031" }),
    ).success).toBe(true);
    expect(FiscalDocumentListRequestSchema.safeParse(request({
      sale_id: "550e8400-e29b-41d4-a716-446655440031", branch_id: "550e8400-e29b-41d4-a716-446655440013",
    })).success).toBe(false);
  });

  it("distingue no registrado de sin identificar", () => {
    const doc = (acquirer_kind: string, acquirer_customer_id: string | null) => ({
      outcome: "LISTED",
      documents: [{
        document_id: "550e8400-e29b-41d4-a716-446655440040", document_type: "SALES_INVOICE",
        transport_status: "COMPLETED", normalized_result: "ACCEPTED",
        issued_prefix: "SETP", issued_number: "990000001", acquirer_kind, acquirer_customer_id,
      }],
    });
    expect(FiscalDocumentListResultSchema.safeParse(doc("NOT_RECORDED", null)).success).toBe(true);
    expect(FiscalDocumentListResultSchema.safeParse(doc("NOT_IDENTIFIED", null)).success).toBe(true);
    expect(FiscalDocumentListResultSchema.safeParse(
      doc("IDENTIFIED", "550e8400-e29b-41d4-a716-446655440032"),
    ).success).toBe(true);
    expect(FiscalDocumentListResultSchema.safeParse(doc("ANONIMO", null)).success).toBe(false);
  });
});
