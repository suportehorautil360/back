import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { FirebaseService } from '../../config/firebase.service';
import { normalizarChassi } from './helpers/chassi.helper';

@Injectable()
export class ChecklistChassiService {
  constructor(private readonly firebase: FirebaseService) {}

  async resolverChassi(chassiInput: string) {
    const chassi = normalizarChassi(chassiInput);
    if (!chassi) throw new NotFoundException('Chassi vazio.');

    const eqSnap = await this.firebase
      .getFirestore()
      .collection('equipamentos')
      .where('chassis', '==', chassi)
      .limit(5)
      .get();

    if (eqSnap.empty) throw new NotFoundException('Chassi não encontrado.');

    // Buscar clientes das prefeituraIds únicas e filtrar por chassi habilitado
    const prefIds = [
      ...new Set(
        eqSnap.docs.map((d) => d.get('prefeituraId') as string).filter(Boolean),
      ),
    ];

    const clientesDocs = await Promise.all(
      prefIds.map((id) =>
        this.firebase.getFirestore().collection('clientes').doc(id).get(),
      ),
    );

    const habilitadas = clientesDocs
      .filter((d) => d.exists)
      .filter(
        (d) =>
          (d.get('checklistLogin') as { chassi?: boolean } | undefined)
            ?.chassi === true,
      );

    if (habilitadas.length === 0)
      throw new NotFoundException(
        'A empresa vinculada ao chassi não habilita login por chassi.',
      );

    if (habilitadas.length > 1)
      throw new ConflictException(
        'Chassi vinculado a múltiplas empresas com login habilitado.',
      );

    const cliDoc = habilitadas[0];
    const equipamento = eqSnap.docs.find(
      (e) => e.get('prefeituraId') === cliDoc.id,
    )!;

    return {
      empresaId: cliDoc.id,
      empresaNome: (cliDoc.get('nome') as string) ?? cliDoc.id,
      idMaquina: equipamento.id,
      chassi,
    };
  }
}
