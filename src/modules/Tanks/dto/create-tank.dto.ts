// tanks/dto/create-tank.dto.ts
import { IsNotEmpty, IsString, IsNumber } from 'class-validator';

export class CreateTankDto {
  @IsString()
  @IsNotEmpty()
  name!: string; // Ex: T0-01

  @IsString()
  @IsNotEmpty()
  fuelType!: string; // Ex: Diesel S10

  @IsNumber()
  @IsNotEmpty()
  capacity!: number; // Ex: 20000

  @IsNumber()
  currentVolume: number = 0; // Começa zerado
}
