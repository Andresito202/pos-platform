/**
 * Se lanza cuando un valor viola el modelo de autorización de forma que no
 * representa una denegación de permiso sino una construcción imposible. Una
 * denegación es un resultado legítimo; esto es un error del llamador.
 */
export class AuthorizationModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationModelError";
  }
}
