import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
app.enableCors(); // фронт пока статический прототип (localhost:8000, Pages)
app.enableShutdownHooks();
const port = Number(process.env.PORT ?? 3000);
await app.listen(port, "127.0.0.1");
console.log(`API: http://localhost:${port}/health`);
