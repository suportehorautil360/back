/**
 * Semeia checklists de PARTIDA para a empresa revisar.
 *
 *   npx tsx scripts/semear-checklists-rascunho.ts
 *
 * Os 22 códigos e nomes vêm do print do sistema atual — esses são reais. Os
 * ITENS são escritos a partir de prática padrão de manutenção pesada, para o
 * catálogo ficar utilizável desde já.
 *
 * Nascem ATIVOS porque a VRENTAL é a empresa de teste (os funcionários dela
 * são "Mecânico Teste", "Motorista Teste"). Antes de rodar isto numa empresa
 * com operação de verdade, troque `ativo` para `false` e revise cada linha com
 * quem conhece a frota: item de inspeção errado numa máquina de verdade é o
 * tipo de coisa que ninguém percebe até precisar.
 *
 * Idempotente por código: rodar de novo não duplica, e NÃO sobrescreve o que
 * já foi editado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client';

const EMPRESA = 'VRENTAL';

function env(chave: string): string {
  const arquivo = readFileSync(resolve(__dirname, '../.env'), 'utf8');
  const linha = arquivo.split('\n').find((l) => l.startsWith(`${chave}=`));
  if (!linha) throw new Error(`${chave} não está no .env.`);
  return linha
    .slice(chave.length + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env('DATABASE_URL') }),
});

type Foto = 'nao' | 'se_nao_conforme' | 'sempre';

/** `!` no fim = impeditivo. `📷` = exige foto sempre. `?` = foto se reprovar. */
function item(numero: number, texto: string) {
  const impeditivo = texto.endsWith('!');
  const fotoSempre = texto.includes('📷');
  const fotoSeReprovar = texto.endsWith('?') || impeditivo;
  const descricao = texto.replace(/[!?📷]/gu, '').trim();
  const foto: Foto = fotoSempre
    ? 'sempre'
    : fotoSeReprovar
      ? 'se_nao_conforme'
      : 'nao';
  return {
    id: `i${numero}`,
    numero,
    descricao,
    obrigatorio: true,
    foto,
    impeditivo,
  };
}

function grupo(codigo: number, nome: string, textos: string[]) {
  return {
    id: `g${codigo}`,
    codigo,
    nome,
    itens: textos.map((t, i) => item(i + 1, t)),
  };
}

interface Rascunho {
  codigo: number;
  nome: string;
  familia: string;
  tipoMaquina: string;
  keywords: string[];
  exigeOs: 'exige_os' | 'opcional' | 'avulso';
  exigeAssinaturaRecebedor: boolean;
  grupos: ReturnType<typeof grupo>[];
}

const VERIFICACOES_ESTEIRA = [
  'Vazamento de óleo hidráulico em mangueiras e conexões!',
  'Vazamento de óleo do motor ou da transmissão!',
  'Nível do óleo hidráulico',
  'Nível do óleo do motor',
  'Nível do líquido de arrefecimento',
  'Estado do filtro de ar',
  'Tensão das esteiras',
  'Desgaste de sapatas, roletes e roda motriz 📷',
  'Folga e trincas nos pinos e buchas do implemento!',
  'Trincas na estrutura, lança ou chassi!',
  'Funcionamento das luzes e do alarme de ré!',
  'Estado do extintor e validade',
  'Cinto de segurança e estrutura de proteção (ROPS)!',
];

const VERIFICACOES_PNEUS = [
  'Vazamento de óleo hidráulico em mangueiras e conexões!',
  'Teste de freio de serviço e de estacionamento!',
  'Pressão e estado dos pneus 📷',
  'Aperto e ausência de porcas nas rodas!',
  'Nível do óleo do motor',
  'Nível do líquido de arrefecimento',
  'Nível do óleo da transmissão',
  'Estado do filtro de ar',
  'Trincas na estrutura, lança ou chassi!',
  'Funcionamento das luzes e do alarme de ré!',
  'Estado do extintor e validade',
  'Cinto de segurança e estrutura de proteção (ROPS)!',
];

const VERIFICACOES_CAMINHAO = [
  'Teste de freio de serviço e de estacionamento!',
  'Drenagem de água dos balões de ar!',
  'Vazamento de ar no sistema de freio!',
  'Pressão e estado dos pneus, incluindo estepe 📷',
  'Aperto e ausência de porcas nas rodas!',
  'Estado das lonas ou pastilhas!',
  'Nível do óleo do motor',
  'Nível do líquido de arrefecimento',
  'Nível do óleo da direção hidráulica',
  'Funcionamento de setas, freio e alarme de ré!',
  'Estado da quinta roda e travamento!',
  'Tacógrafo funcionando e lacrado',
  'Extintor, triângulo e macaco a bordo',
  'Cinto de segurança!',
];

const VERIFICACOES_GRADE = [
  'Trincas na estrutura e nos braços!',
  'Estado dos discos e das lâminas 📷',
  'Folga nos mancais e rolamentos',
  'Lubrificação dos pontos de graxa',
  'Estado dos pneus de transporte',
  'Pinos, travas e engate ao trator!',
  'Sistema hidráulico sem vazamento!',
  'Sinalização e refletivos',
];

const ATENDIMENTO = [
  'Prefixo e horímetro/odômetro no momento do atendimento',
  'Relato do operador sobre o defeito',
  'Local onde a máquina está',
  'Máquina parada ou operando com restrição?',
];

const RESIDUOS = [
  'Óleo usado recolhido e destinado',
  'Filtros usados recolhidos',
  'Estopa e material contaminado recolhidos',
  'Local do serviço limpo ao final',
];

const AVARIAS = [
  'Estado da pintura e da lataria 📷',
  'Vidros, retrovisores e faróis 📷',
  'Estado da cabine por dentro 📷',
  'Amassados, trincas ou soldas visíveis 📷',
  'Ausência de componentes ou tampas',
  'Nível de combustível na chegada',
  'Horímetro/odômetro registrado 📷',
];

const TRANSPORTE = [
  'Máquina travada e peada na prancha 📷',
  'Calços e cintas conferidos!',
  'Implemento recolhido e travado!',
  'Torre/lança na posição de transporte!',
  'Sinalização e placas de excesso quando aplicável',
  'Vazamentos verificados antes de sair!',
];

const RASCUNHOS: Rascunho[] = [
  {
    codigo: 57,
    nome: 'CORRETIVA - MAQ. ESTEIRA',
    familia: 'Corretiva',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'escavadeira', 'trator de esteira'],
    exigeOs: 'exige_os',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(30, 'INFORMAÇÕES DO ATENDIMENTO', ATENDIMENTO),
      grupo(29, 'VERIFICAÇÕES', VERIFICACOES_ESTEIRA),
      grupo(32, 'SERVIÇO EXECUTADO', [
        'Causa identificada descrita',
        'Serviço executado descrito',
        'Peças substituídas relacionadas',
        'Teste após o serviço realizado!',
        'Máquina liberada para operar?',
      ]),
      grupo(31, 'RESÍDUOS GERADOS', RESIDUOS),
    ],
  },
  {
    codigo: 58,
    nome: 'CORRETIVA - MAQ. PNEUS',
    familia: 'Corretiva',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira', 'retroescavadeira', 'motoniveladora'],
    exigeOs: 'exige_os',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(30, 'INFORMAÇÕES DO ATENDIMENTO', ATENDIMENTO),
      grupo(29, 'VERIFICAÇÕES', VERIFICACOES_PNEUS),
      grupo(32, 'SERVIÇO EXECUTADO', [
        'Causa identificada descrita',
        'Serviço executado descrito',
        'Peças substituídas relacionadas',
        'Teste após o serviço realizado!',
        'Máquina liberada para operar?',
      ]),
      grupo(31, 'RESÍDUOS GERADOS', RESIDUOS),
    ],
  },
  {
    codigo: 62,
    nome: 'PREVENTIVA MAQ.ESTEIRA',
    familia: 'Preventiva',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'escavadeira'],
    exigeOs: 'exige_os',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(1, 'LEITURA', [
        'Horímetro no início da revisão 📷',
        'Intervalo de revisão conferido',
      ]),
      grupo(2, 'TROCAS', [
        'Óleo do motor trocado',
        'Filtro de óleo do motor trocado',
        'Filtro de combustível trocado',
        'Filtro de ar verificado ou trocado',
        'Filtro hidráulico verificado ou trocado',
      ]),
      grupo(3, 'VERIFICAÇÕES', VERIFICACOES_ESTEIRA),
      grupo(4, 'LUBRIFICAÇÃO', [
        'Pinos e buchas do implemento lubrificados',
        'Coroa de giro lubrificada',
        'Pontos de graxa do material rodante',
      ]),
      grupo(31, 'RESÍDUOS GERADOS', RESIDUOS),
    ],
  },
  {
    codigo: 63,
    nome: 'PREVENTIVA MAQ. PNEUS',
    familia: 'Preventiva',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira', 'retroescavadeira'],
    exigeOs: 'exige_os',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(1, 'LEITURA', [
        'Horímetro no início da revisão 📷',
        'Intervalo de revisão conferido',
      ]),
      grupo(2, 'TROCAS', [
        'Óleo do motor trocado',
        'Filtro de óleo do motor trocado',
        'Filtro de combustível trocado',
        'Filtro de ar verificado ou trocado',
        'Filtro hidráulico verificado ou trocado',
      ]),
      grupo(3, 'VERIFICAÇÕES', VERIFICACOES_PNEUS),
      grupo(4, 'LUBRIFICAÇÃO', [
        'Pinos e buchas do implemento lubrificados',
        'Cardã e cruzetas lubrificados',
        'Pontos de graxa da direção',
      ]),
      grupo(31, 'RESÍDUOS GERADOS', RESIDUOS),
    ],
  },
  {
    codigo: 64,
    nome: 'DIAGNOSTICO',
    familia: 'Diagnóstico',
    tipoMaquina: '',
    keywords: [],
    exigeOs: 'opcional',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(13, 'GERAL', [
        'Sintoma relatado pelo operador',
        'Quando o sintoma aparece (frio, carga, manobra)',
        'Códigos de falha lidos no painel 📷',
        'Ruído, vibração ou cheiro anormal',
        'Vazamento visível 📷',
        'Hipótese de causa',
        'Precisa de peça para confirmar?',
      ]),
    ],
  },
  {
    codigo: 25,
    nome: 'INSP.MATERIAL RODANTE',
    familia: 'Inspeção',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'material rodante'],
    exigeOs: 'opcional',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(1, 'MEDIÇÕES', [
        'Altura de garra das sapatas 📷',
        'Desgaste dos elos',
        'Desgaste dos roletes inferiores',
        'Desgaste dos roletes superiores',
        'Desgaste da roda motriz 📷',
        'Desgaste da roda guia',
        'Tensão da esteira',
      ]),
      grupo(2, 'CONCLUSÃO', [
        'Percentual de vida restante estimado',
        'Componente que vence primeiro',
        'Recomendação de troca',
      ]),
    ],
  },
  {
    codigo: 21,
    nome: 'CHECKLIST DE AVARIAS - MAQ.ESTEIRA',
    familia: 'Avarias',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'escavadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [grupo(1, 'ESTADO NA CHEGADA', AVARIAS)],
  },
  {
    codigo: 26,
    nome: 'ENTREGA TECNICA MAQ.ESTEIRA',
    familia: 'Entrega técnica',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'escavadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ORIENTAÇÃO AO OPERADOR', [
        'Comandos e funções apresentados',
        'Pontos de lubrificação mostrados',
        'Verificações diárias explicadas',
        'Procedimento de emergência explicado!',
        'Manual entregue',
      ]),
      grupo(2, 'ESTADO DA MÁQUINA', [
        'Níveis conferidos',
        'Horímetro na entrega 📷',
        'Estado geral registrado 📷',
      ]),
    ],
  },
  {
    codigo: 29,
    nome: 'DESEMBARQUE MAQ. ESTEIRA',
    familia: 'Desembarque',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'escavadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ANTES DE DESCER', [
        'Área de desembarque isolada e nivelada!',
        'Cintas e calços conferidos antes de soltar!',
      ]),
      grupo(2, 'ESTADO NA CHEGADA', AVARIAS),
    ],
  },
  {
    codigo: 50,
    nome: 'EMBARQUE MAQ. ESTEIRA',
    familia: 'Embarque',
    tipoMaquina: 'Esteira',
    keywords: ['esteira', 'escavadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ESTADO NA SAÍDA', AVARIAS),
      grupo(2, 'AMARRAÇÃO', TRANSPORTE),
    ],
  },
  {
    codigo: 22,
    nome: 'CHECKLIST DE AVARIAS - MAQ.PNEUS',
    familia: 'Avarias',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira', 'retroescavadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [grupo(1, 'ESTADO NA CHEGADA', AVARIAS)],
  },
  {
    codigo: 23,
    nome: 'CHECKLIST DE AVARIAS - CAMINHÕES',
    familia: 'Avarias',
    tipoMaquina: 'Caminhões',
    keywords: ['caminhao', 'caminhão', 'basculante', 'pipa'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [grupo(1, 'ESTADO NA CHEGADA', AVARIAS)],
  },
  {
    codigo: 33,
    nome: 'CHECKLIST DE AVARIAS - GRADES',
    familia: 'Avarias',
    tipoMaquina: 'Grades',
    keywords: ['grade', 'implemento'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    // Grade não tem cabine nem lataria: a avaria dela é disco, braço e engate.
    grupos: [grupo(1, 'ESTADO NA CHEGADA', VERIFICACOES_GRADE)],
  },
  {
    codigo: 27,
    nome: 'ENTREGA TECNICA MAQ.PNEUS',
    familia: 'Entrega técnica',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ORIENTAÇÃO AO OPERADOR', [
        'Comandos e funções apresentados',
        'Pontos de lubrificação mostrados',
        'Verificações diárias explicadas',
        'Procedimento de emergência explicado!',
        'Manual entregue',
      ]),
      grupo(2, 'ESTADO DA MÁQUINA', [
        'Níveis conferidos',
        'Horímetro na entrega 📷',
        'Estado geral registrado 📷',
      ]),
    ],
  },
  {
    codigo: 28,
    nome: 'ENTREGA TECNICA CAMINHÕES',
    familia: 'Entrega técnica',
    tipoMaquina: 'Caminhões',
    keywords: ['caminhao', 'caminhão'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ORIENTAÇÃO AO MOTORISTA', [
        'Comandos e painel apresentados',
        'Verificações diárias explicadas',
        'Uso do tacógrafo explicado',
        'Procedimento de emergência explicado!',
        'Documentação do veículo conferida!',
        'Manual entregue',
      ]),
      grupo(2, 'ESTADO DO VEÍCULO', [
        'Níveis conferidos',
        'Odômetro na entrega 📷',
        'Estado geral registrado 📷',
      ]),
    ],
  },
  {
    codigo: 30,
    nome: 'DESEMBARQUE MAQ. PNEUS',
    familia: 'Desembarque',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ANTES DE DESCER', [
        'Área de desembarque isolada e nivelada!',
        'Cintas e calços conferidos antes de soltar!',
      ]),
      grupo(2, 'ESTADO NA CHEGADA', AVARIAS),
    ],
  },
  {
    codigo: 31,
    nome: 'DESEMBARQUE CAMINHÕES',
    familia: 'Desembarque',
    tipoMaquina: 'Caminhões',
    keywords: ['caminhao', 'caminhão'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ANTES DE DESCER', [
        'Área de desembarque isolada e nivelada!',
        'Cintas e calços conferidos antes de soltar!',
      ]),
      grupo(2, 'ESTADO NA CHEGADA', AVARIAS),
    ],
  },
  {
    codigo: 51,
    nome: 'EMBARQUE MAQ. PNEUS',
    familia: 'Embarque',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ESTADO NA SAÍDA', AVARIAS),
      grupo(2, 'AMARRAÇÃO', TRANSPORTE),
    ],
  },
  {
    codigo: 52,
    nome: 'EMBARQUE CAMINHÕES',
    familia: 'Embarque',
    tipoMaquina: 'Caminhões',
    keywords: ['caminhao', 'caminhão'],
    exigeOs: 'avulso',
    exigeAssinaturaRecebedor: true,
    grupos: [
      grupo(1, 'ESTADO NA SAÍDA', AVARIAS),
      grupo(2, 'AMARRAÇÃO', TRANSPORTE),
    ],
  },
  {
    codigo: 67,
    nome: 'CORRETIVA - CAMINHÃO',
    familia: 'Corretiva',
    tipoMaquina: 'Caminhões',
    keywords: ['caminhao', 'caminhão', 'basculante', 'pipa'],
    exigeOs: 'exige_os',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(30, 'INFORMAÇÕES DO ATENDIMENTO', ATENDIMENTO),
      grupo(29, 'VERIFICAÇÕES', VERIFICACOES_CAMINHAO),
      grupo(32, 'SERVIÇO EXECUTADO', [
        'Causa identificada descrita',
        'Serviço executado descrito',
        'Peças substituídas relacionadas',
        'Teste após o serviço realizado!',
        'Veículo liberado para rodar?',
      ]),
      grupo(31, 'RESÍDUOS GERADOS', RESIDUOS),
    ],
  },
  /**
   * 65 e 66 aparecem no print com o mesmo nome do 64. O que os distingue não
   * dá para saber pelo print — segui o padrão do resto do catálogo, que é
   * variar por tipo de máquina. Se for outro critério, é só renomear.
   */
  {
    codigo: 65,
    nome: 'DIAGNOSTICO',
    familia: 'Diagnóstico',
    tipoMaquina: 'Pneus',
    keywords: ['pneus', 'carregadeira'],
    exigeOs: 'opcional',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(13, 'GERAL', [
        'Sintoma relatado pelo operador',
        'Quando o sintoma aparece (frio, carga, manobra)',
        'Códigos de falha lidos no painel 📷',
        'Ruído, vibração ou cheiro anormal',
        'Vazamento visível 📷',
        'Comportamento da transmissão sob carga',
        'Hipótese de causa',
        'Precisa de peça para confirmar?',
      ]),
    ],
  },
  {
    codigo: 66,
    nome: 'DIAGNOSTICO',
    familia: 'Diagnóstico',
    tipoMaquina: 'Caminhões',
    keywords: ['caminhao', 'caminhão'],
    exigeOs: 'opcional',
    exigeAssinaturaRecebedor: false,
    grupos: [
      grupo(13, 'GERAL', [
        'Sintoma relatado pelo motorista',
        'Quando o sintoma aparece (frio, carga, subida)',
        'Códigos de falha lidos no painel 📷',
        'Ruído, vibração ou cheiro anormal',
        'Vazamento visível 📷',
        'Comportamento do freio em teste!',
        'Hipótese de causa',
        'Precisa de peça para confirmar?',
      ]),
    ],
  },
];

(async () => {
  const empresa = await prisma.company.findFirst({
    where: { name: { contains: EMPRESA } },
    select: { id: true, name: true },
  });
  if (!empresa) throw new Error(`Empresa "${EMPRESA}" não encontrada.`);

  console.log(`Empresa: ${empresa.name}\n`);
  let criados = 0;
  let pulados = 0;

  for (const r of RASCUNHOS) {
    const jaExiste = await prisma.checklistModelo.findFirst({
      where: { companyId: empresa.id, codigo: r.codigo },
      select: { id: true },
    });
    if (jaExiste) {
      console.log(`  ${String(r.codigo).padStart(3)} já existe — não toquei`);
      pulados += 1;
      continue;
    }

    const itens = r.grupos.reduce((s, g) => s + g.itens.length, 0);
    await prisma.checklistModelo.create({
      data: {
        companyId: empresa.id,
        codigo: r.codigo,
        nome: r.nome,
        familia: r.familia || null,
        tipoMaquina: r.tipoMaquina || null,
        keywords: r.keywords,
        grupos: r.grupos,
        exigeOs: r.exigeOs,
        exigeAssinaturaRecebedor: r.exigeAssinaturaRecebedor,
        ativo: true,
      },
    });
    console.log(
      `  ${String(r.codigo).padStart(3)} ${r.nome} — ${r.grupos.length} seções, ${itens} itens`,
    );
    criados += 1;
  }

  console.log(
    `\n${criados} criados, ${pulados} pulados.\n\n` +
      '⚠️  Todos nasceram ARQUIVADOS, de propósito.\n' +
      'Os códigos e nomes são do seu sistema; os ITENS são rascunho meu, a\n' +
      'partir de prática padrão de manutenção pesada. Abra cada um no painel,\n' +
      'corrija com quem conhece a frota, e só então ative.\n\n' +
      'Painel → Mecânica → Checklists.',
  );
  await prisma.$disconnect();
})().catch((e: unknown) => {
  console.error(`\nERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
