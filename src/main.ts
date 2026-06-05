import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
  console.log(`🚀Servidor rodando na porta ${process.env.PORT ?? 3000}`);
  console.log(
    `📖Documentação disponível em http://localhost:${process.env.PORT ?? 3000}/api/docs`,
  );
}
bootstrap();
