from datetime import datetime

from pydantic import BaseModel, EmailStr


class ProveedorCreate(BaseModel):
    nit: str
    nombre: str
    contacto: str | None = None
    telefono: str | None = None
    email: EmailStr | None = None
    direccion: str | None = None


class ProveedorUpdate(BaseModel):
    nombre: str | None = None
    contacto: str | None = None
    telefono: str | None = None
    email: EmailStr | None = None
    direccion: str | None = None
    activo: bool | None = None


class ProveedorOut(BaseModel):
    id: int
    nit: str
    nombre: str
    contacto: str | None
    telefono: str | None
    email: str | None
    direccion: str | None
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}
