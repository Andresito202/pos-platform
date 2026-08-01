from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.venta import EstadoVenta, MetodoPago


class DetalleVentaIn(BaseModel):
    producto_id: int
    cantidad: Decimal

    @field_validator("cantidad")
    @classmethod
    def cantidad_positiva(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("La cantidad debe ser mayor a cero")
        return v


class VentaCreate(BaseModel):
    cliente_id: int | None = None
    metodo_pago: MetodoPago = MetodoPago.efectivo
    observaciones: str | None = None
    detalles: list[DetalleVentaIn]

    @field_validator("detalles")
    @classmethod
    def al_menos_un_detalle(cls, v: list) -> list:
        if not v:
            raise ValueError("La venta debe tener al menos un producto")
        return v


class DetalleVentaOut(BaseModel):
    id: int
    producto_id: int
    lote_id: int | None
    cantidad: Decimal
    precio_unitario: Decimal
    subtotal: Decimal

    model_config = {"from_attributes": True}


class VentaOut(BaseModel):
    id: int
    numero: str
    cliente_id: int | None
    usuario_id: int
    caja_id: int | None
    fecha: datetime
    subtotal: Decimal
    descuento: Decimal
    total: Decimal
    metodo_pago: MetodoPago
    estado: EstadoVenta
    observaciones: str | None
    detalles: list[DetalleVentaOut]

    model_config = {"from_attributes": True}
