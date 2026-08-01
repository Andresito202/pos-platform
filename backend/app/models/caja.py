import enum
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class EstadoCaja(str, enum.Enum):
    abierta = "abierta"
    cerrada = "cerrada"


class TipoMovimientoCaja(str, enum.Enum):
    ingreso = "ingreso"
    egreso = "egreso"
    venta = "venta"
    apertura = "apertura"


class Caja(Base):
    __tablename__ = "cajas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    fecha_apertura: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    fecha_cierre: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    monto_apertura: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    monto_cierre: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    monto_esperado: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    diferencia: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    estado: Mapped[EstadoCaja] = mapped_column(Enum(EstadoCaja), default=EstadoCaja.abierta)
    observaciones: Mapped[str | None] = mapped_column(Text, nullable=True)

    movimientos: Mapped[list["MovimientoCaja"]] = relationship(back_populates="caja")


class MovimientoCaja(Base):
    __tablename__ = "movimientos_caja"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    caja_id: Mapped[int] = mapped_column(ForeignKey("cajas.id"), nullable=False)
    tipo: Mapped[TipoMovimientoCaja] = mapped_column(Enum(TipoMovimientoCaja), nullable=False)
    monto: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    caja: Mapped["Caja"] = relationship(back_populates="movimientos")
