from datetime import datetime

from pydantic import BaseModel, EmailStr


class ClienteCreate(BaseModel):
    documento: str
    nombre: str
    telefono: str | None = None
    email: EmailStr | None = None


class ClienteUpdate(BaseModel):
    nombre: str | None = None
    telefono: str | None = None
    email: EmailStr | None = None
    activo: bool | None = None


class ClienteOut(BaseModel):
    id: int
    documento: str
    nombre: str
    telefono: str | None
    email: str | None
    activo: bool
    created_at: datetime

    model_config = {"from_attributes": True}
