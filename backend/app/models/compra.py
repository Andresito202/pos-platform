import enum
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EstadoCompra(str, enum.Enum):
    pendiente = "pendiente"
    recibida = "recibida"
    anulada = "anulada"


class Compra(Base):
    __tablename__ = "compras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    proveedor_id: Mapped[int] = mapped_column(ForeignKey("proveedores.id"), nullable=False)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    fecha: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    total: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, default=0)
    estado: Mapped[EstadoCompra] = mapped_column(
        Enum(EstadoCompra), default=EstadoCompra.pendiente
    )
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    proveedor: Mapped["Proveedor"] = relationship()  # noqa: F821
    usuario: Mapped["Usuario"] = relationship()  # noqa: F821
    detalles: Mapped[list["DetalleCompra"]] = relationship(back_populates="compra")


class DetalleCompra(Base):
    __tablename__ = "detalle_compras"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    compra_id: Mapped[int] = mapped_column(ForeignKey("compras.id"), nullable=False)
    producto_id: Mapped[int] = mapped_column(ForeignKey("productos.id"), nullable=False)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    costo_unitario: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)

    compra: Mapped["Compra"] = relationship(back_populates="detalles")
    producto: Mapped["Producto"] = relationship()  # noqa: F821
