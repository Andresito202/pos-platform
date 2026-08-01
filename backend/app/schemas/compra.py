from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.compra import EstadoCompra


class DetalleCompraIn(BaseModel):
    producto_id: int
    cantidad: Decimal
    costo_unitario: Decimal

    @field_validator("cantidad", "costo_unitario")
    @classmethod
    def positivo(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Debe ser mayor a cero")
        return v


class CompraCreate(BaseModel):
    proveedor_id: int
    observaciones: str | None = None
    detalles: list[DetalleCompraIn]

    @field_validator("detalles")
    @classmethod
    def al_menos_un_detalle(cls, v: list) -> list:
        if not v:
            raise ValueError("La compra debe tener al menos un detalle")
        return v


class DetalleCompraOut(BaseModel):
    id: int
    producto_id: int
    cantidad: Decimal
    costo_unitario: Decimal
    subtotal: Decimal

    model_config = {"from_attributes": True}


class CompraOut(BaseModel):
    id: int
    proveedor_id: int
    usuario_id: int
    fecha: datetime
    total: Decimal
    estado: EstadoCompra
    observaciones: str | None
    detalles: list[DetalleCompraOut]

    model_config = {"from_attributes": True}
