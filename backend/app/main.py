from contextlib import asynccontextmanager
from pathlib import Path
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.categorias import router as categorias_router
from app.api.productos import router as productos_router
from app.api.proveedores import router as proveedores_router
from app.api.compras import router as compras_router
from app.api.inventario import router as inventario_router
from app.api.clientes import router as clientes_router
from app.api.ventas import router as ventas_router
from app.api.caja import router as caja_router
from app.api.mermas import router as mermas_router
from app.api.reportes import router as reportes_router
from app.api.auditoria import router as auditoria_router
from app.core.config import settings
from app.core.database import Base, engine
from app.core.security import hash_password
from app.models import *  # noqa: F401,F403 - Importa todos los modelos para crear tablas
from app.models.usuario import RolEnum, Usuario


def _create_admin_if_needed():
    from app.core.database import SessionLocal

    db = SessionLocal()
    try:
        existing = db.query(Usuario).filter(Usuario.username == settings.ADMIN_USERNAME).first()
        if not existing:
            admin = Usuario(
                username=settings.ADMIN_USERNAME,
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD),
                nombre_completo="Administrador del Sistema",
                rol=RolEnum.admin,
            )
            db.add(admin)
            db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.AUTO_CREATE_TABLES:
        Base.metadata.create_all(bind=engine)

    # La instancia publica es una demo de portafolio: debe recuperar su
    # catalogo y actividad idempotente aunque un servicio existente de Render
    # conserve una configuracion anterior sin SEED_DEMO_DATA.
    should_seed_demo = settings.SEED_DEMO_DATA or settings.ENVIRONMENT.lower() == "production"
    if should_seed_demo:
        app_root = Path(__file__).resolve().parent.parent
        repo_root = app_root.parent
        for path in (app_root, repo_root):
            if str(path) not in sys.path:
                sys.path.append(str(path))
        from database.seeds.seed_data import seed

        seed(create_schema=settings.AUTO_CREATE_TABLES)
    else:
        _create_admin_if_needed()
    yield


app = FastAPI(
    title="Supermercado Avicola - API",
    description="Sistema de gestion para supermercado avicola",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(categorias_router, prefix="/api")
app.include_router(productos_router, prefix="/api")
app.include_router(proveedores_router, prefix="/api")
app.include_router(compras_router, prefix="/api")
app.include_router(inventario_router, prefix="/api")
app.include_router(clientes_router, prefix="/api")
app.include_router(ventas_router, prefix="/api")
app.include_router(caja_router, prefix="/api")
app.include_router(mermas_router, prefix="/api")
app.include_router(reportes_router, prefix="/api")
app.include_router(auditoria_router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "project": "Supermercado Avicola"}


# --- Servir frontend ---
# Busca /frontend (Docker) o ../frontend (local)
_configured_frontend_path = Path(settings.FRONTEND_DIR) if settings.FRONTEND_DIR else None
_docker_path = Path("/frontend")
_local_path = Path(__file__).resolve().parent.parent.parent / "frontend"
FRONTEND_DIR = (
    _configured_frontend_path
    if _configured_frontend_path and _configured_frontend_path.exists()
    else _docker_path
    if _docker_path.exists()
    else _local_path
)

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR / "static")), name="static")

    @app.get("/{page}.html")
    def serve_page(page: str):
        file_path = FRONTEND_DIR / f"{page}.html"
        if file_path.exists():
            return FileResponse(str(file_path))
        return FileResponse(str(FRONTEND_DIR / "login.html"))

    @app.get("/")
    def serve_root():
        return FileResponse(str(FRONTEND_DIR / "login.html"))
