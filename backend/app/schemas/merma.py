from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.merma import MotivoMerma


class MermaCreate(BaseModel):
    producto_id: int
    lote_id: int | None = None
    cantidad: Decimal
    motivo: MotivoMerma
    descripcion: str | None = None

    @field_validator("cantidad")
    @classmethod
    def cantidad_positiva(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("La cantidad debe ser mayor a cero")
        return v


class MermaOut(BaseModel):
    id: int
    producto_id: int
    lote_id: int | None
    cantidad: Decimal
    motivo: MotivoMerma
    descripcion: str | None
    usuario_id: int
    created_at: datetime

    model_config = {"from_attributes": True}
