"""Migracion inicial - 15 tablas del supermercado avicola

Revision ID: 001
Revises: None
Create Date: 2026-03-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Usuarios ---
    op.create_table(
        "usuarios",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("username", sa.String(50), unique=True, nullable=False),
        sa.Column("email", sa.String(120), unique=True, nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("nombre_completo", sa.String(150), nullable=False),
        sa.Column("rol", sa.Enum("admin", "cajero", "bodeguero", "supervisor", "gerente", name="rolenum"), nullable=False),
        sa.Column("activo", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    # --- Categorias ---
    op.create_table(
        "categorias",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nombre", sa.String(100), unique=True, nullable=False),
        sa.Column("descripcion", sa.Text, nullable=True),
        sa.Column("activa", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Productos ---
    op.create_table(
        "productos",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("codigo", sa.String(50), unique=True, nullable=False),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column("descripcion", sa.Text, nullable=True),
        sa.Column("categoria_id", sa.Integer, sa.ForeignKey("categorias.id"), nullable=False),
        sa.Column("unidad_medida", sa.Enum("unidad", "kilogramo", "libra", "gramo", "litro", name="unidadmedida"), nullable=False),
        sa.Column("precio_compra", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("precio_venta", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("stock_minimo", sa.Integer, default=0),
        sa.Column("es_perecedero", sa.Boolean, default=False),
        sa.Column("activo", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
    )

    # --- Proveedores ---
    op.create_table(
        "proveedores",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nit", sa.String(20), unique=True, nullable=False),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column("contacto", sa.String(150), nullable=True),
        sa.Column("telefono", sa.String(20), nullable=True),
        sa.Column("email", sa.String(120), nullable=True),
        sa.Column("direccion", sa.Text, nullable=True),
        sa.Column("activo", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Clientes ---
    op.create_table(
        "clientes",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("documento", sa.String(20), unique=True, nullable=False),
        sa.Column("nombre", sa.String(150), nullable=False),
        sa.Column("telefono", sa.String(20), nullable=True),
        sa.Column("email", sa.String(120), nullable=True),
        sa.Column("activo", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Compras ---
    op.create_table(
        "compras",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("proveedor_id", sa.Integer, sa.ForeignKey("proveedores.id"), nullable=False),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("fecha", sa.DateTime(timezone=True)),
        sa.Column("total", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("estado", sa.Enum("pendiente", "recibida", "anulada", name="estadocompra"), nullable=False),
        sa.Column("observaciones", sa.Text, nullable=True),
    )

    op.create_table(
        "detalle_compras",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("compra_id", sa.Integer, sa.ForeignKey("compras.id"), nullable=False),
        sa.Column("producto_id", sa.Integer, sa.ForeignKey("productos.id"), nullable=False),
        sa.Column("cantidad", sa.Numeric(12, 3), nullable=False),
        sa.Column("costo_unitario", sa.Numeric(12, 2), nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False),
    )

    # --- Lotes ---
    op.create_table(
        "lotes",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("codigo_lote", sa.String(50), nullable=False),
        sa.Column("producto_id", sa.Integer, sa.ForeignKey("productos.id"), nullable=False),
        sa.Column("compra_id", sa.Integer, sa.ForeignKey("compras.id"), nullable=True),
        sa.Column("cantidad_inicial", sa.Numeric(12, 3), nullable=False),
        sa.Column("cantidad_disponible", sa.Numeric(12, 3), nullable=False),
        sa.Column("costo_unitario", sa.Numeric(12, 2), nullable=False),
        sa.Column("fecha_ingreso", sa.Date, nullable=False),
        sa.Column("fecha_vencimiento", sa.Date, nullable=True),
        sa.Column("agotado", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Cajas ---
    op.create_table(
        "cajas",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("fecha_apertura", sa.DateTime(timezone=True)),
        sa.Column("fecha_cierre", sa.DateTime(timezone=True), nullable=True),
        sa.Column("monto_apertura", sa.Numeric(14, 2), nullable=False),
        sa.Column("monto_cierre", sa.Numeric(14, 2), nullable=True),
        sa.Column("monto_esperado", sa.Numeric(14, 2), nullable=True),
        sa.Column("diferencia", sa.Numeric(14, 2), nullable=True),
        sa.Column("estado", sa.Enum("abierta", "cerrada", name="estadocaja"), nullable=False),
        sa.Column("observaciones", sa.Text, nullable=True),
    )

    op.create_table(
        "movimientos_caja",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("caja_id", sa.Integer, sa.ForeignKey("cajas.id"), nullable=False),
        sa.Column("tipo", sa.Enum("ingreso", "egreso", "venta", "apertura", name="tipomovimientocaja"), nullable=False),
        sa.Column("monto", sa.Numeric(14, 2), nullable=False),
        sa.Column("descripcion", sa.Text, nullable=True),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Ventas ---
    op.create_table(
        "ventas",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("numero", sa.String(20), unique=True, nullable=False),
        sa.Column("cliente_id", sa.Integer, sa.ForeignKey("clientes.id"), nullable=True),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("caja_id", sa.Integer, sa.ForeignKey("cajas.id"), nullable=True),
        sa.Column("fecha", sa.DateTime(timezone=True)),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("descuento", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("metodo_pago", sa.Enum("efectivo", "tarjeta", "transferencia", "mixto", name="metodopago"), nullable=False),
        sa.Column("estado", sa.Enum("completada", "anulada", name="estadoventa"), nullable=False),
        sa.Column("observaciones", sa.Text, nullable=True),
    )

    op.create_table(
        "detalle_ventas",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("venta_id", sa.Integer, sa.ForeignKey("ventas.id"), nullable=False),
        sa.Column("producto_id", sa.Integer, sa.ForeignKey("productos.id"), nullable=False),
        sa.Column("lote_id", sa.Integer, sa.ForeignKey("lotes.id"), nullable=True),
        sa.Column("cantidad", sa.Numeric(12, 3), nullable=False),
        sa.Column("precio_unitario", sa.Numeric(12, 2), nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 2), nullable=False),
    )

    # --- Movimientos Inventario ---
    op.create_table(
        "movimientos_inventario",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("producto_id", sa.Integer, sa.ForeignKey("productos.id"), nullable=False),
        sa.Column("lote_id", sa.Integer, sa.ForeignKey("lotes.id"), nullable=True),
        sa.Column("tipo", sa.Enum("entrada", "salida", "ajuste_positivo", "ajuste_negativo", "merma", "devolucion", name="tipomovimiento"), nullable=False),
        sa.Column("cantidad", sa.Numeric(12, 3), nullable=False),
        sa.Column("referencia_id", sa.Integer, nullable=True),
        sa.Column("referencia_tipo", sa.Text, nullable=True),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("observaciones", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Mermas ---
    op.create_table(
        "mermas",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("producto_id", sa.Integer, sa.ForeignKey("productos.id"), nullable=False),
        sa.Column("lote_id", sa.Integer, sa.ForeignKey("lotes.id"), nullable=True),
        sa.Column("cantidad", sa.Numeric(12, 3), nullable=False),
        sa.Column("motivo", sa.Enum("vencimiento", "dano", "robo", "ajuste", "otro", name="motivomerma"), nullable=False),
        sa.Column("descripcion", sa.Text, nullable=True),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )

    # --- Auditoria ---
    op.create_table(
        "auditoria",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("usuario_id", sa.Integer, sa.ForeignKey("usuarios.id"), nullable=False),
        sa.Column("accion", sa.String(100), nullable=False),
        sa.Column("entidad", sa.String(50), nullable=False),
        sa.Column("entidad_id", sa.Integer, nullable=True),
        sa.Column("detalle", sa.Text, nullable=True),
        sa.Column("ip", sa.String(45), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True)),
    )


def downgrade() -> None:
    op.drop_table("auditoria")
    op.drop_table("mermas")
    op.drop_table("movimientos_inventario")
    op.drop_table("detalle_ventas")
    op.drop_table("ventas")
    op.drop_table("movimientos_caja")
    op.drop_table("cajas")
    op.drop_table("lotes")
    op.drop_table("detalle_compras")
    op.drop_table("compras")
    op.drop_table("clientes")
    op.drop_table("proveedores")
    op.drop_table("productos")
    op.drop_table("categorias")
    op.drop_table("usuarios")
