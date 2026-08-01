from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"

    DB_USER: str = "avicola_user"
    DB_PASSWORD: str = "avicola_pass"
    DB_HOST: str = "db"
    DB_PORT: str = "5432"
    DB_NAME: str = "supermercado_avicola"
    DATABASE_URL: str = ""

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS: str = ""
    AUTO_CREATE_TABLES: bool = True
    SEED_DEMO_DATA: bool = False
    FRONTEND_DIR: str = ""

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str
    ADMIN_EMAIL: str = "admin@avicola.local"

    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    @property
    def db_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        return (
            f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if len(value.strip()) < 32:
            raise ValueError("SECRET_KEY debe tener al menos 32 caracteres")
        return value

    @field_validator("ADMIN_PASSWORD")
    @classmethod
    def validate_admin_password(cls, value: str) -> str:
        if len(value.strip()) < 8:
            raise ValueError("ADMIN_PASSWORD debe tener al menos 8 caracteres")
        return value

    @model_validator(mode="after")
    def validate_production_settings(self) -> "Settings":
        if self.ENVIRONMENT.lower() != "production":
            return self

        if "*" in self.cors_origins:
            raise ValueError("CORS_ORIGINS no puede usar '*' en produccion")
        if self.SECRET_KEY.startswith("local-demo-secret-key"):
            raise ValueError("SECRET_KEY de ejemplo no puede usarse en produccion")
        if self.ADMIN_PASSWORD == "change-this-admin-password":
            raise ValueError("ADMIN_PASSWORD debe cambiarse antes de produccion")

        return self


settings = Settings()
