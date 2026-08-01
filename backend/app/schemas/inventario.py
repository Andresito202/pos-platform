from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.inventario import TipoMovimiento


class MovimientoInventarioOut(BaseModel):
    id: int
    producto_id: int
    lote_id: int | None
    tipo: TipoMovimiento
    cantidad: Decimal
    referencia_id: int | None
    referencia_tipo: str | None
    usuario_id: int
    observaciones: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AjusteInventarioIn(BaseModel):
    producto_id: int
    lote_id: int | None = None
    cantidad: Decimal
    tipo: TipoMovimiento
    observaciones: str | None = None

    @field_validator("cantidad")
    @classmethod
    def cantidad_positiva(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("La cantidad debe ser mayor a cero")
        return v

    @field_validator("tipo")
    @classmethod
    def solo_ajustes(cls, v: TipoMovimiento) -> TipoMovimiento:
        permitidos = {TipoMovimiento.ajuste_positivo, TipoMovimiento.ajuste_negativo}
        if v not in permitidos:
            raise ValueError("Solo se permiten ajustes positivos o negativos")
        return v


class StockProducto(BaseModel):
    producto_id: int
    producto_nombre: str
    producto_codigo: str
    stock_total: Decimal
    stock_minimo: int
    alerta_stock_bajo: bool
