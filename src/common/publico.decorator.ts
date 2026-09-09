import { SetMetadata } from '@nestjs/common';

export const PUBLICO_KEY = 'rota_publica';

/**
 * Marca uma rota que deve mesmo ser aberta: login, health check, webhook com
 * assinatura própria.
 *
 * Existe para a inversão que vem na fase 3 do fechamento da API. Hoje o padrão
 * do sistema é abrir e lembrar de fechar — esquecer o guard deixa a rota
 * exposta e nada avisa. Com o guard global, esquecer o `@Publico()` deixa a
 * rota FECHADA: quebra na hora, em desenvolvimento, para quem escreveu. O erro
 * passa a falhar do lado seguro.
 *
 * Na fase 2 (observação) ele já serve para o observador não registrar o que é
 * legitimamente aberto — senão o log encheria de login, que é ruído conhecido.
 */
export const Publico = () => SetMetadata(PUBLICO_KEY, true);
