from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, field_validator

from app.models.producto import UnidadMedida


class ProductoCreate(BaseModel):
    codigo: str
    nombre: str
    descripcion: str | None = None
    categoria_id: int
    unidad_medida: UnidadMedida = UnidadMedida.unidad
    precio_compra: Decimal
    precio_venta: Decimal
    stock_minimo: int = 0
    es_perecedero: bool = False

    @field_validator("precio_compra", "precio_venta")
    @classmethod
    def precio_positivo(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("El precio no puede ser negativo")
        return v

    @field_validator("stock_minimo")
    @classmethod
    def stock_no_negativo(cls, v: int) -> int:
        if v < 0:
            raise ValueError("El stock minimo no puede ser negativo")
        return v


class ProductoUpdate(BaseModel):
    nombre: str | None = None
    descripcion: str | None = None
    categoria_id: int | None = None
    unidad_medida: UnidadMedida | None = None
    precio_compra: Decimal | None = None
    precio_venta: Decimal | None = None
    stock_minimo: int | None = None
    es_perecedero: bool | None = None
    activo: bool | None = None

    @field_validator("precio_compra", "precio_venta")
    @classmethod
    def precio_positivo(cls, v: Decimal | None) -> Decimal | None:
        if v is not None and v < 0:
            raise ValueError("El precio no puede ser negativo")
        return v


class ProductoOut(BaseModel):
    id: int
    codigo: str
    nombre: str
    descripcion: str | None
    categoria_id: int
    unidad_medida: UnidadMedida
    precio_compra: Decimal
    precio_venta: Decimal
    stock_minimo: int
    es_perecedero: bool
    activo: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProductoConCategoria(ProductoOut):
    categoria_nombre: str | None = None
