import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Minha API Profissional')
    .setDescription('Documentação dos endpoints do sistema')
    .setVersion('1.0')
    .addTag('allocations')
    .addTag('revision')
    .addTag('work-front')
    .addTag('vehicles')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
