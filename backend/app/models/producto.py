import enum
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UnidadMedida(str, enum.Enum):
    unidad = "unidad"
    kilogramo = "kilogramo"
    libra = "libra"
    gramo = "gramo"
    litro = "litro"


class Producto(Base):
    __tablename__ = "productos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    codigo: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    nombre: Mapped[str] = mapped_column(String(150), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    categoria_id: Mapped[int] = mapped_column(ForeignKey("categorias.id"), nullable=False)
    unidad_medida: Mapped[UnidadMedida] = mapped_column(
        Enum(UnidadMedida), nullable=False, default=UnidadMedida.unidad
    )
    precio_compra: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    precio_venta: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    stock_minimo: Mapped[int] = mapped_column(Integer, default=0)
    es_perecedero: Mapped[bool] = mapped_column(Boolean, default=False)
    activo: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    categoria: Mapped["Categoria"] = relationship(back_populates="productos")  # noqa: F821
    lotes: Mapped[list["Lote"]] = relationship(back_populates="producto")  # noqa: F821
