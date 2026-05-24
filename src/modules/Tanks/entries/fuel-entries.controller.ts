import { Controller, Body, Post } from '@nestjs/common';
import { FuelEntriesService } from './fuel-entries.service';
import { CreateFuelEntryDto } from '../dto/create-fuel-entry.dto';

@Controller('fuel-entries')
export class FuelEntriesController {
  constructor(private readonly fuelEntriesService: FuelEntriesService) {}

  @Post('')
  create(@Body() createFuelEntryDto: CreateFuelEntryDto) {
    return this.fuelEntriesService.createEntry(createFuelEntryDto);
  }
}
