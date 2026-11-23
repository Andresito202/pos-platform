/**
 * Presentation helper for admin.metrics.get values.
 *
 * null never means zero. A numeric 0 is a real reading. null means the field
 * was not authorized for aggregate read or is not yet published by the service.
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
          detail: "Esta sesión no autoriza la lectura agregada de este indicador.",
        }
      : {
          availability: "unavailable",
          label: "No disponible",
          detail: "El servicio aún no publica este agregado para el alcance autorizado.",
        };
  }
  if (value === 0 && options.emptyLabel) {
    return { availability: "empty", label: "0", detail: options.emptyLabel };
  }
  return {
    availability: "value",
    label: String(value),
    detail: "Lectura persistida en el alcance de la sesión.",
  };
}

export function presentAdminMetricAmount(
  value: string | null,
  format: (amount: string) => string,
): AdminMetricPresentation {
  if (value === null) {
    return {
      availability: "unavailable",
      label: "No disponible",
      detail: "El agregado monetario requiere permiso financiero de Reporting aún no materializado.",
    };
  }
  return {
    availability: "value",
    label: format(value),
    detail: "Importe total persistido en el alcance de la sesión.",
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
      label: "Error de consulta",
      detail: options.error,
    };
  }
  if (options.busy && !options.hasLoadedValue) {
    return {
      availability: "loading",
      label: "Consultando…",
      detail: "Solicitando admin.metrics.get al servicio local.",
    };
  }
  return null;
}
