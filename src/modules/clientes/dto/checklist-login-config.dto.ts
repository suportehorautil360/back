import {
  IsBoolean,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'PeloMenos1Modo' })
class PeloMenos1ModoAtivo implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments) {
    const o = args.object as { cpfSenha?: boolean; chassi?: boolean };
    return Boolean(o.cpfSenha) || Boolean(o.chassi);
  }
  defaultMessage() {
    return 'Pelo menos um modo (cpfSenha ou chassi) deve estar ativo.';
  }
}

export class ChecklistLoginConfigDto {
  @IsBoolean()
  cpfSenha!: boolean;

  @IsBoolean()
  @Validate(PeloMenos1ModoAtivo)
  chassi!: boolean;
}
