from datetime import datetime

from pydantic import BaseModel


class AuditoriaOut(BaseModel):
    id: int
    usuario_id: int
    accion: str
    entidad: str
    entidad_id: int | None
    detalle: str | None
    ip: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
