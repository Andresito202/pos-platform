from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.caja import EstadoCaja, TipoMovimientoCaja


class CajaAbrirIn(BaseModel):
    monto_apertura: Decimal

    @field_validator("monto_apertura")
    @classmethod
    def monto_positivo(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("El monto de apertura no puede ser negativo")
        return v


class CajaCerrarIn(BaseModel):
    monto_cierre: Decimal
    observaciones: str | None = None


class MovimientoCajaIn(BaseModel):
    tipo: TipoMovimientoCaja
    monto: Decimal
    descripcion: str | None = None

    @field_validator("monto")
    @classmethod
    def monto_positivo(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("El monto debe ser mayor a cero")
        return v

    @field_validator("tipo")
    @classmethod
    def solo_ingreso_egreso(cls, v: TipoMovimientoCaja) -> TipoMovimientoCaja:
        if v not in {TipoMovimientoCaja.ingreso, TipoMovimientoCaja.egreso}:
            raise ValueError("Solo se permiten movimientos de ingreso o egreso")
        return v


class MovimientoCajaOut(BaseModel):
    id: int
    caja_id: int
    tipo: TipoMovimientoCaja
    monto: Decimal
    descripcion: str | None
    usuario_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CajaOut(BaseModel):
    id: int
    usuario_id: int
    fecha_apertura: datetime
    fecha_cierre: datetime | None
    monto_apertura: Decimal
    monto_cierre: Decimal | None
    monto_esperado: Decimal | None
    diferencia: Decimal | None
    estado: EstadoCaja
    observaciones: str | None
    movimientos: list[MovimientoCajaOut]

    model_config = {"from_attributes": True}
