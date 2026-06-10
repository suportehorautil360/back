/**
 * Seed das definições de checklist (catálogo GLOBAL).
 *
 * GERADO a partir de `src/data/hu360OperadorSeed.json` do frontend, replicando o
 * dedup-por-texto e a renumeração de `itensDaCategoria`. A ORDEM do array
 * preserva a precedência da inferência por palavra-chave (subtipos antes do
 * genérico "Caminhões"). Não editar à mão — recriar pelo script de geração.
 */
export interface SeedChecklistDefinition {
  slug: string;
  nome: string;
  categoria: string;
  keywords: string[];
  itens: {
    ordem: number;
    texto: string;
    severidade: 'impeditivo' | 'normal';
  }[];
}

export const SEED_CHECKLIST_DEFINITIONS: SeedChecklistDefinition[] = [
  {
    slug: 'carro-leve',
    nome: 'Carro Leve',
    categoria: 'Carro Leve',
    keywords: [
      'carro leve',
      'linha leve',
      'veiculo leve',
      'veículo leve',
      'automovel',
      'automóvel',
    ],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto:
          'Portas, Capô e Porta-Malas: Fechamento completo, travas elétricas e trincos',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Palhetas e Esguicho de Água do Para-brisa (Funcionamento)',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto:
          'Nível do Fluido do Radiador (Expansão) e Óleo de Câmbio/Direção',
        severidade: 'normal',
      },
      {
        ordem: 24,
        texto: 'Ar-Condicionado / Desembaçador Dianteiro e Traseiro',
        severidade: 'normal',
      },
      {
        ordem: 25,
        texto:
          'Vidros Elétricos / Manuais: Abertura e fechamento total sem travamentos',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'caminhao-munck',
    nome: 'Caminhão Munck',
    categoria: 'Caminhão Munck',
    keywords: ['munck', 'munk'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'Estado dos pistões das patolas (sem vazamento ou riscos)',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Travas mecânicas de segurança e sapatas estabilizadoras',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'Vazamento hidráulico no bloco de comando ou mangueiras',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'Ganchos com trava de segurança operando',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'Estado dos cabos de aço (sem desfiados) ou cintas de içamento',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto: 'Presença de trincas estruturais na base, torre ou lanças',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto: 'Funcionamento do botão de parada de emergência do implemento',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto: 'Nível do óleo hidráulico no visor do tanque do munck',
        severidade: 'normal',
      },
      {
        ordem: 29,
        texto: 'Engate da tomada de força (ruídos ou dificuldades)',
        severidade: 'normal',
      },
      {
        ordem: 30,
        texto: 'Lubrificação (graxa) nas lanças telescópicas e articulações',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'caminhao-pipa',
    nome: 'Caminhão Pipa',
    categoria: 'Caminhão Pipa',
    keywords: ['pipa'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'Fixação do tanque ao chassi (estado dos grampos e coxins)',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Trincas na solda ou rachaduras com vazamento grave no tanque',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'Registros principais e válvulas pneumáticas de abertura',
        severidade: 'normal',
      },
      {
        ordem: 24,
        texto: 'Barra de irrigação traseira (chuveirinho) e bicos desentupidos',
        severidade: 'normal',
      },
      {
        ordem: 25,
        texto: "Funcionamento da motobomba / bomba d'água acoplada",
        severidade: 'normal',
      },
      {
        ordem: 26,
        texto: 'Canhão monitor (articulação livre e pressão do jato)',
        severidade: 'normal',
      },
      {
        ordem: 27,
        texto: 'Estado das mangueiras de sucção e ferramentas de engate rápido',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'caminhao-basculante',
    nome: 'Caminhão Basculante',
    categoria: 'Caminhão Basculante',
    keywords: ['basculante'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'Pistão hidráulico central (caneco) sem vazamentos ou empenos',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Trava de segurança automática de abertura da tampa traseira',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'Alarme sonoro e visual de caçamba erguida dentro da cabine',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'Pinos de articulação traseira da caçamba (presença de travas)',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'Presença da trava física de segurança para manutenção',
        severidade: 'normal',
      },
      {
        ordem: 26,
        texto: 'Estado das chapas da caçamba e do protetor de cabine (boné)',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'betoneira',
    nome: 'Betoneira',
    categoria: 'Betoneira',
    keywords: ['betoneira'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'Rolete de apoio do balão (sem travamentos, folgas ou trincas)',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Sistema de giro do redutor e motor auxiliar operando em carga',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'Trava mecânica de transporte das calhas de descarga traseiras',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'Nível do óleo do redutor de velocidade (sem vazamento)',
        severidade: 'normal',
      },
      {
        ordem: 25,
        texto: 'Sistema de pressurização do tanque de água de limpeza',
        severidade: 'normal',
      },
      {
        ordem: 26,
        texto: 'Limpeza de resíduos de concreto no funil, balão e calhas',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'comboio',
    nome: 'Comboio',
    categoria: 'Comboio',
    keywords: ['comboio'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto:
          'Kit de emergência ambiental completo (mantas, pá, enxada, balde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Extintor de pó químico do implemento e cabo de aterramento',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto:
          'Vazamentos aparentes nos tanques de óleo diesel, óleos ou graxa',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'Presença e legibilidade dos painéis ONU e rótulos de risco',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'Bombas de abastecimento e medidores de vazão (bicos)',
        severidade: 'normal',
      },
      {
        ordem: 26,
        texto: 'Carretéis retráteis e estado de conservação das mangueiras',
        severidade: 'normal',
      },
      {
        ordem: 27,
        texto: 'Compressor de ar do comboio (nível de óleo e dreno do balão)',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'ambulancia',
    nome: 'Ambulância',
    categoria: 'Ambulância',
    keywords: ['ambulancia', 'ambulância'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto:
          'Sinalização Sonora e Visual: Sirene e giroflex de emergência operando',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto:
          'Oxigenoterapia: Cilindro principal e transporte (carga e validade)',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto:
          'Rede de Gases: Fluxômetros, umidificadores e máscaras operacionais',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto:
          'Maca Retrátil: Funcionamento de travas de pernas e cintos de fixação',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto:
          'Equipamentos de Trauma: Prancha rígida completa e colares cervicais',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto:
          'Higienização Crítica: Ausência de odores e manchas biológicas no salão',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto: 'Descarte de Perfurocortantes: Caixa coletora amarela instalada',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto:
          'Climatização do Salão: Ar-condicionado traseiro regulando temperatura',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto: 'Iluminação do Salão: Luzes brancas e azul de cortesia operando',
        severidade: 'normal',
      },
      {
        ordem: 30,
        texto:
          'Inversor / Rede Elétrica: Tomadas internas de 110/220V com energia',
        severidade: 'normal',
      },
      {
        ordem: 31,
        texto:
          'Armários e Fixações: Portas de acrílico e malas travadas em nichos',
        severidade: 'normal',
      },
      {
        ordem: 32,
        texto:
          'Suportes de Soro/Plasma: Ganchos superiores íntegros e ajustáveis',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'oficina',
    nome: 'Oficina',
    categoria: 'Oficina',
    keywords: ['oficina'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'Fixação de bancadas, armários, morsas e ferramentas pesadas',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Isolamento da rede elétrica interna (sem fios expostos)',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto:
          'Funcionamento do gerador de energia e nível de óleo/combustível',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'Compressor de ar (funcionamento e drenagem do reservatório)',
        severidade: 'normal',
      },
      {
        ordem: 25,
        texto: 'Iluminação interna do furgão para trabalhos noturnos',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'bau',
    nome: 'Baú',
    categoria: 'Baú',
    keywords: ['baú', 'bau'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'Portas traseiras/laterais fechando e travando firmemente',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'Estado das borrachas de vedação contra poeira e água da chuva',
        severidade: 'normal',
      },
      {
        ordem: 23,
        texto: 'Integridade do assoalho (sem furos ou tábuas/chapas soltas)',
        severidade: 'normal',
      },
      {
        ordem: 24,
        texto: 'Faixas refletivas laterais e traseiras limpas e coladas',
        severidade: 'normal',
      },
    ],
  },
  {
    slug: 'motoniveladora',
    nome: 'Motoniveladora',
    categoria: 'Motoniveladora',
    keywords: ['motoniveladora'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto:
          'ÓLEOS: Verificar nível do motor, transmissão, tandem e hidráulico',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'FILTROS: Verificar e drenar sedimentador de combustível',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'LUBRIFICAÇÃO: Engraxar círculo de giro, articulações e pinos',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto:
          'CILINDROS/MANGUEIRAS: Verificar vazamentos e integridade das hastes',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'PNEUS: Verificar calibragem, cortes, bolhas e aperto de porcas',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto:
          'ESTRUTURA/CHASSIS: Verificar trincas no chassi e suporte da lâmina',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto: 'PINOS/TRAVAS: Verificar folgas em pinos e travas de segurança',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto:
          'IMPLEMENTO: Verificar facas da lâmina, parafusos e escarificador',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto: 'SEGURANÇA: Testar luzes, freio, buzina e sinal sonoro de ré',
        severidade: 'impeditivo',
      },
    ],
  },
  {
    slug: 'escavadeira',
    nome: 'Escavadeira',
    categoria: 'Escavadeira',
    keywords: ['escavadeira'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'ÓLEOS: Verificar nível do motor, hidráulico e comandos finais',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'FILTROS: Verificar e drenar separador de água do combustível',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'LUBRIFICAÇÃO: Engraxar pinos da lança, braço, caçamba e giro',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'CILINDROS/MANGUEIRAS: Verificar limpeza de hastes e vazamentos',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'PARTE RODANTE: Verificar tensão da esteira, roletes e guias',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto:
          'ESTRUTURA/CHASSIS: Verificar chassi inferior e proteção da cabine',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto:
          'PINOS/TRAVAS: Verificar folgas nos pinos de articulação e travas',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto:
          'IMPLEMENTO: Verificar dentes, unhas e pinos de trava da caçamba',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto: 'SEGURANÇA: Testar buzina, luzes de trabalho e alarme de ré',
        severidade: 'impeditivo',
      },
    ],
  },
  {
    slug: 'trator-de-esteira',
    nome: 'Trator de Esteira',
    categoria: 'Trator de Esteira',
    keywords: ['trator de esteira'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'ÓLEOS: Verificar nível do motor, transmissão e hidráulico',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'FILTROS: Verificar e drenar filtros de combustível',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'LUBRIFICAÇÃO: Engraxar articulações da lâmina e do ripper',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto:
          'CILINDROS/MANGUEIRAS: Verificar vazamentos nos cilindros de lâmina',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'PARTE RODANTE: Verificar sapatas e dentes da roda motriz',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto: 'ESTRUTURA/CHASSIS: Verificar chassis e pinos mestres',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto: 'PINOS/TRAVAS: Verificar travas de segurança e pinos de fixação',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto: 'IMPLEMENTO: Verificar ponteiras do ripper e bordas da lâmina',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto:
          'SEGURANÇA: Testar freio de estacionamento, luzes e alarme sonoro',
        severidade: 'impeditivo',
      },
    ],
  },
  {
    slug: 'picador-de-madeira',
    nome: 'Picador de Madeira',
    categoria: 'Picador de Madeira',
    keywords: ['picador', 'picador de madeira', 'chipper'],
    itens: [
      {
        ordem: 1,
        texto:
          'Facas e contrafacas estão sem trincas, quebras ou desgaste excessivo?',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Os parafusos de fixação das facas estão com o torque/aperto correto?',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto:
          'O rotor/tambor está limpo e livre de detritos ou materiais travados?',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto:
          'A folga entre faca e contrafaca está dentro do padrão do fabricante?',
        severidade: 'normal',
      },
      {
        ordem: 5,
        texto:
          'O sistema de afiação (se houver) está regulado e com a pedra em bom estado?',
        severidade: 'normal',
      },
      {
        ordem: 6,
        texto:
          'Os rolos alimentadores (mordentes) estão com os dentes inteiros e limpos?',
        severidade: 'normal',
      },
      {
        ordem: 7,
        texto:
          'A mesa de alimentação ou esteira está com a tensão da corrente correta?',
        severidade: 'normal',
      },
      {
        ordem: 8,
        texto:
          'Os cilindros hidráulicos dos rolos estão livres de vazamentos nas vedações?',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto:
          'As mangueiras de alta pressão da mesa estão sem sinais de atrito ou desgaste?',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Os níveis de fluidos (óleo do motor, radiador, combustível/Arla) estão adequados?',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto:
          'O pré-filtro e o filtro de ar estão limpos (livres de excesso de serragem)?',
        severidade: 'normal',
      },
      {
        ordem: 12,
        texto:
          'As correias e polias da transmissão estão tensionadas e sem rachaduras?',
        severidade: 'normal',
      },
      {
        ordem: 13,
        texto:
          'A embreagem / PTO (Tomada de Força) aciona suavemente, sem patinar?',
        severidade: 'normal',
      },
      {
        ordem: 14,
        texto:
          'O nível do óleo hidráulico está correto no visor (máquina nivelada)?',
        severidade: 'impeditivo',
      },
      {
        ordem: 15,
        texto:
          'O bloco de válvulas, comandos e conexões estão livres de vazamentos?',
        severidade: 'impeditivo',
      },
      {
        ordem: 16,
        texto:
          'O tubo de descarga (calha/bica) gira e opera o defletor hidráulico normalmente?',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto:
          'O revestimento interno da bica está sem furos ou desgaste crítico por abrasão?',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto:
          'A bateria está com cabos firmes, limpos e sem sinais de oxidação (zinabre)?',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto:
          'O alternador está gerando carga corretamente e a correia está tensionada?',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto:
          'A chave geral (disjuntor principal) está operando perfeitamente e sem folgas?',
        severidade: 'impeditivo',
      },
      {
        ordem: 21,
        texto:
          'O painel de instrumentos, displays e chicotes estão protegidos e funcionando?',
        severidade: 'normal',
      },
      {
        ordem: 22,
        texto:
          'Todos os botões de emergência (E-Stops) e barras de reversão funcionam?',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto:
          'As proteções e carenagens de polias, correias e rotor estão fixas e fechadas?',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto:
          'O sistema de combate a incêndio / extintores estão na carga e desimpedidos?',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto:
          'O chassi, sapatas estabilizadoras e pneus/esteiras estão sem danos ou trincas?',
        severidade: 'impeditivo',
      },
    ],
  },
  {
    slug: 'caminhoes',
    nome: 'Caminhões',
    categoria: 'Caminhões',
    keywords: ['caminhão', 'caminhao'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'ÓLEOS: Verificar nível do motor, direção e arrefecimento',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'FILTROS: Verificar e drenar filtros separadores de diesel',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto:
          'LUBRIFICAÇÃO: Engraxar articulações, quinta roda ou pinos de mola',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto:
          'CILINDROS/MANGUEIRAS: Verificar sistema de basculamento/munk/pipa',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'PNEUS: Verificar calibragem, sulcos e estado geral',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto: 'ESTRUTURA/CHASSIS: Verificar grampos de fixação e chassis',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto:
          'PINOS/TRAVAS: Verificar travas de carroceria e pinos de suporte',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto: 'IMPLEMENTO: Verificar estado do tanque, caçamba ou braço munk',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto: 'SEGURANÇA: Testar todas as luzes, buzina e alarme de ré',
        severidade: 'impeditivo',
      },
    ],
  },
  {
    slug: 'retroescavadeira',
    nome: 'Retroescavadeira',
    categoria: 'Retroescavadeira',
    keywords: ['retroescavadeira'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'ÓLEOS: Verificar nível do motor, transmissão e hidráulico',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'FILTROS: Verificar e drenar filtros de combustível (Racor)',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'LUBRIFICAÇÃO: Engraxar caçamba frontal e braço traseiro',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto:
          'CILINDROS/MANGUEIRAS: Verificar estabilizadores e mangueiras do braço',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'PNEUS: Verificar pressão e estado das carcaças',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto:
          'ESTRUTURA/CHASSIS: Verificar chassis e suportes dos estabilizadores',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto: 'PINOS/TRAVAS: Verificar travas de transporte do braço traseiro',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto: 'IMPLEMENTO: Verificar dentes da retro e sapatas das patolas',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto: 'SEGURANÇA: Testar freio, buzina, luzes e alarme de ré',
        severidade: 'impeditivo',
      },
    ],
  },
  {
    slug: 'pa-carregadeira',
    nome: 'Pá Carregadeira',
    categoria: 'Pá Carregadeira',
    keywords: ['pa carregadeira', 'pá carregadeira', 'carregadeira'],
    itens: [
      {
        ordem: 1,
        texto: 'Teste de freio de serviço e estacionário (freio de mão)',
        severidade: 'impeditivo',
      },
      {
        ordem: 2,
        texto:
          'Drenagem de água dos balões de ar do freio (ou teste de hidrovácuo em leves)',
        severidade: 'impeditivo',
      },
      {
        ordem: 3,
        texto: 'Pneus dianteiros e traseiros (sulco/TWI e sem cortes)',
        severidade: 'impeditivo',
      },
      {
        ordem: 4,
        texto: 'Estado do estepe e aperto das porcas das rodas',
        severidade: 'impeditivo',
      },
      {
        ordem: 5,
        texto: 'Folga excessiva no volante ou estalos na direção/suspensão',
        severidade: 'impeditivo',
      },
      {
        ordem: 6,
        texto: 'Faróis (alto e baixo) e luzes de seta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 7,
        texto: 'Luz de freio, luz de ré e pisca-alerta funcionando',
        severidade: 'impeditivo',
      },
      {
        ordem: 8,
        texto:
          'Para-brisa (sem trincas na área de visão) e palhetas do limpador',
        severidade: 'impeditivo',
      },
      {
        ordem: 9,
        texto: 'Retrovisores esquerdo/direito (sem quebras e regulados)',
        severidade: 'impeditivo',
      },
      {
        ordem: 10,
        texto:
          'Extintor de incêndio da cabine (validade e pressão na faixa verde)',
        severidade: 'impeditivo',
      },
      {
        ordem: 11,
        texto: 'Cintos de segurança (motorista e passageiro travando)',
        severidade: 'impeditivo',
      },
      {
        ordem: 12,
        texto: 'Triângulo de sinalização, macaco e chave de roda',
        severidade: 'impeditivo',
      },
      {
        ordem: 13,
        texto: 'Validade da CNH do condutor e documento do veículo (CRLV)',
        severidade: 'impeditivo',
      },
      {
        ordem: 14,
        texto: 'Nível do óleo do motor e nível do líquido de arrefecimento',
        severidade: 'normal',
      },
      {
        ordem: 15,
        texto:
          'Nível do fluido de freio/embreagem e óleo da direção hidráulica',
        severidade: 'normal',
      },
      {
        ordem: 16,
        texto: 'Luzes secundárias (luz de placa, lanternas de posição/Marias)',
        severidade: 'normal',
      },
      {
        ordem: 17,
        texto: 'Marcador de combustível e funcionamento do odômetro/horímetro',
        severidade: 'normal',
      },
      {
        ordem: 18,
        texto: 'Luzes de advertência do painel de instrumentos apagadas',
        severidade: 'normal',
      },
      {
        ordem: 19,
        texto: 'Funcionamento da buzina e do ar-condicionado/ventilador',
        severidade: 'normal',
      },
      {
        ordem: 20,
        texto: 'Limpeza e higienização geral dentro da cabine',
        severidade: 'normal',
      },
      {
        ordem: 21,
        texto: 'ÓLEOS: Verificar nível do motor, transmissão e hidráulico',
        severidade: 'impeditivo',
      },
      {
        ordem: 22,
        texto: 'FILTROS: Verificar e drenar sedimentador de combustível',
        severidade: 'impeditivo',
      },
      {
        ordem: 23,
        texto: 'LUBRIFICAÇÃO: Engraxar articulação central e braços da caçamba',
        severidade: 'impeditivo',
      },
      {
        ordem: 24,
        texto: 'CILINDROS/MANGUEIRAS: Verificar vazamentos e hastes de levante',
        severidade: 'impeditivo',
      },
      {
        ordem: 25,
        texto: 'PNEUS: Verificar calibragem, cortes e aperto de porcas',
        severidade: 'impeditivo',
      },
      {
        ordem: 26,
        texto: 'ESTRUTURA/CHASSIS: Verificar trincas na articulação central',
        severidade: 'impeditivo',
      },
      {
        ordem: 27,
        texto: 'PINOS/TRAVAS: Verificar folgas em pinos e travas de segurança',
        severidade: 'impeditivo',
      },
      {
        ordem: 28,
        texto: 'IMPLEMENTO: Verificar lâminas de corte e dentes da caçamba',
        severidade: 'impeditivo',
      },
      {
        ordem: 29,
        texto: 'SEGURANÇA: Testar freio, buzina, luzes e sinal sonoro de ré',
        severidade: 'impeditivo',
      },
    ],
  },
];
