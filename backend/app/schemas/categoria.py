from datetime import datetime

from pydantic import BaseModel


class CategoriaCreate(BaseModel):
    nombre: str
    descripcion: str | None = None


class CategoriaUpdate(BaseModel):
    nombre: str | None = None
    descripcion: str | None = None
    activa: bool | None = None


class CategoriaOut(BaseModel):
    id: int
    nombre: str
    descripcion: str | None
    activa: bool
    created_at: datetime

    model_config = {"from_attributes": True}
