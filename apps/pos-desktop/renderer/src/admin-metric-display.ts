/**
 * Presentation helper for admin.metrics.get values.
 *
 * Technical note for maintainers: null never means zero. A numeric 0 is a real
 * reading. null means the field was not authorized for aggregate read or is not
 * yet published by the service. UI copy stays merchant-facing.
 */
export type AdminMetricAvailability = "value" | "unavailable" | "forbidden" | "empty" | "error" | "loading";

export type AdminMetricPresentation = {
  readonly availability: AdminMetricAvailability;
  readonly label: string;
  readonly detail: string;
};

export function presentAdminMetricCount(
  value: number | null,
  options: { readonly whenNull: "unavailable" | "forbidden"; readonly emptyLabel?: string },
): AdminMetricPresentation {
  if (value === null) {
    return options.whenNull === "forbidden"
      ? {
          availability: "forbidden",
          label: "Sin permiso",
          detail: "No tienes permiso para consultar este indicador.",
        }
      : {
          availability: "unavailable",
          label: "Información no disponible",
          detail: "Este indicador aún no se puede consultar en tu instalación.",
        };
  }
  if (value === 0 && options.emptyLabel) {
    return { availability: "empty", label: "0", detail: options.emptyLabel };
  }
  return {
    availability: "value",
    label: String(value),
    detail: "Dato actual de tu negocio.",
  };
}

export function presentAdminMetricAmount(
  value: string | null,
  format: (amount: string) => string,
): AdminMetricPresentation {
  if (value === null) {
    return {
      availability: "unavailable",
      label: "Información no disponible",
      detail: "Este indicador aún no se puede consultar en tu instalación.",
    };
  }
  return {
    availability: "value",
    label: format(value),
    detail: "Total registrado en tu negocio.",
  };
}

export function presentAdminMetricQueryState(options: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly hasLoadedValue: boolean;
}): AdminMetricPresentation | null {
  if (options.error !== null) {
    return {
      availability: "error",
      label: "No fue posible cargar la información",
      detail: options.error,
    };
  }
  if (options.busy && !options.hasLoadedValue) {
    return {
      availability: "loading",
      label: "Cargando…",
      detail: "Obteniendo la información de tu negocio.",
    };
  }
  return null;
}
