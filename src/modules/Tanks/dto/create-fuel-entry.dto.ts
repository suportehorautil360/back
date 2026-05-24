// tanks/dto/create-fuel-entry.dto.ts
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateFuelEntryDto {
  @IsString()
  @IsNotEmpty()
  tankId!: string;

  @IsNumber()
  @IsNotEmpty()
  volume!: number;

  @IsString()
  @IsNotEmpty()
  supplier!: string;

  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsNumber()
  @IsNotEmpty()
  price!: number;
}
