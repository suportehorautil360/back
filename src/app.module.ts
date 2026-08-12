import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
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
import { CargosPermissaoModule } from './modules/cargos-permissao/cargos-permissao.module';
import { EmergenciesModule } from './modules/emergencies/emergencies.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { ChecklistDefinitionsModule } from './modules/checklist-definitions/checklist-definitions.module';
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
import { AlertasModule } from './modules/alertas/alertas.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { OsModule } from './modules/os/os.module';
import { PlanosPreventivosModule } from './modules/planos-preventivos/planos-preventivos.module';
import { OficinasModule } from './modules/oficinas/oficinas.module';
import { ChecklistChegadaModule } from './modules/checklist-chegada/checklist-chegada.module';
import { ChecklistDevolucaoModule } from './modules/checklist-devolucao/checklist-devolucao.module';
import { ChecklistsRegistrosModule } from './modules/checklists-registros/checklists-registros.module';
import { GarantiasModule } from './modules/garantias/garantias.module';
import { InsumosModule } from './modules/insumos/insumos.module';
import { OcorrenciasModule } from './modules/ocorrencias/ocorrencias.module';
import { NotasFiscaisModule } from './modules/notas-fiscais/notas-fiscais.module';
import { SuporteModule } from './modules/suporte/suporte.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FleetfuelModule } from './modules/fleetfuel/fleetfuel.module';
import { ChecklistAuthModule } from './modules/checklist-auth/checklist-auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
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
    CargosPermissaoModule,
    EmergenciesModule,
    ChecklistsModule,
    ChecklistDefinitionsModule,
    RiskTriageModule,
    UserModule,
    WhatsAppModule,
    ClientesModule,
    ParceirosModule,
    FinanceiroModule,
    MailModule,
    AlertasModule,
    UploadsModule,
    OsModule,
    PlanosPreventivosModule,
    OficinasModule,
    ChecklistChegadaModule,
    ChecklistDevolucaoModule,
    ChecklistsRegistrosModule,
    GarantiasModule,
    InsumosModule,
    OcorrenciasModule,
    NotasFiscaisModule,
    SuporteModule,
    AuthModule,
    UsersModule,
    FleetfuelModule,
    ChecklistAuthModule,
    // ... outros módulos
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
