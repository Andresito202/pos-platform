import enum
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MotivoMerma(str, enum.Enum):
    vencimiento = "vencimiento"
    dano = "dano"
    robo = "robo"
    ajuste = "ajuste"
    otro = "otro"


class Merma(Base):
    __tablename__ = "mermas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    producto_id: Mapped[int] = mapped_column(ForeignKey("productos.id"), nullable=False)
    lote_id: Mapped[int | None] = mapped_column(ForeignKey("lotes.id"), nullable=True)
    cantidad: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    motivo: Mapped[MotivoMerma] = mapped_column(Enum(MotivoMerma), nullable=False)
    descripcion: Mapped[str | None] = mapped_column(Text, nullable=True)
    usuario_id: Mapped[int] = mapped_column(ForeignKey("usuarios.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
