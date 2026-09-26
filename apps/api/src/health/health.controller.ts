import { Controller, Get, Header } from "@nestjs/common";

/**
 * Sólo dice que el proceso atiende. Nada de versión, dependencias ni
 * configuración: un endpoint sin autenticación no debe describir el servidor.
 */
@Controller("v1/health")
export class HealthController {
  @Get()
  @Header("cache-control", "no-store")
  health(): { status: "UP" } {
    return { status: "UP" };
  }
}
