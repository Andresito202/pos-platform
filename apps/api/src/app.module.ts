import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller.js";
import { AuthModule } from "./authentication/auth.module.js";

@Module({ imports: [AuthModule], controllers: [HealthController] })
export class AppModule {}
