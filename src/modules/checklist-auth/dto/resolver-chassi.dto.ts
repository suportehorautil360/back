import { IsNotEmpty, IsString } from 'class-validator';

export class ResolverChassiDto {
  @IsString()
  @IsNotEmpty()
  chassi!: string;
}
