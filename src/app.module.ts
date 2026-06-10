import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { RevisionModule } from './modules/revision/revision.module';
import { WorkFrontModule } from './modules/work-front/work-front.module';
import { AllocationsModule } from './modules/allocations/allocations.module';
import { TimeRecordsModule } from './modules/time-records/time-records.module';
import { SolicitacoesPontoModule } from './modules/solicitacoes-ponto/solicitacoes-ponto.module';
import { NotificacoesModule } from './modules/notificacoes/notificacoes.module';
import { AbonosModule } from './modules/abonos/abonos.module';
import { EscalaModule } from './modules/escala/escala.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { EmergenciesModule } from './modules/emergencies/emergencies.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { RiskTriageModule } from './modules/risk-triage/risk-triage.module';
import { UserModule } from './modules/user/user.module';
import { EquipamentosModule } from './modules/equipamentos/equipamentos.module';
import { FuncionariosModule } from './modules/funcionarios/funcionarios.module';
import { ConfiguracoesModule } from './modules/configuracoes/configuracoes.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { MovimentacoesModule } from './modules/movimentacoes/movimentacoes.module';
import { ClientesModule } from './modules/clientes/clientes.module';
import { ParceirosModule } from './modules/parceiros/parceiros.module';
import { FinanceiroModule } from './modules/financeiro/financeiro.module';
import { MailModule } from './modules/mail/mail.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    VehiclesModule,
    EquipamentosModule,
    FuncionariosModule,
    ConfiguracoesModule,
    MovimentacoesModule,
    RevisionModule,
    WorkFrontModule,
    AllocationsModule,
    TimeRecordsModule,
    SolicitacoesPontoModule,
    NotificacoesModule,
    AbonosModule,
    EscalaModule,
    FeatureFlagsModule,
    EmergenciesModule,
    ChecklistsModule,
    RiskTriageModule,
    UserModule,
    WhatsAppModule,
    ClientesModule,
    ParceirosModule,
    FinanceiroModule,
    MailModule,
    // ... outros módulos
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
