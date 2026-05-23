export class CreateRevisionDto {
  revisionDate!: Date;
  odometerReading!: number;
  mechanicOrOfficeName!: string;
  servicesDescription!: string;
  revisionCost!: number;
  invoiceNumber!: string;
  vehicleId!: string;
  prefeituraId!: string;
}
