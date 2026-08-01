from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class LoteOut(BaseModel):
    id: int
    codigo_lote: str
    producto_id: int
    compra_id: int | None
    cantidad_inicial: Decimal
    cantidad_disponible: Decimal
    costo_unitario: Decimal
    fecha_ingreso: date
    fecha_vencimiento: date | None
    agotado: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertaVencimiento(BaseModel):
    lote_id: int
    codigo_lote: str
    producto_id: int
    producto_nombre: str
    cantidad_disponible: Decimal
    fecha_vencimiento: date
    dias_restantes: int
