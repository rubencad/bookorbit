import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateKomgaUserDto {
  @IsOptional()
  @IsBoolean()
  groupUnknownSeries?: boolean;

  @IsOptional()
  @IsBoolean()
  includeNonComicBooks?: boolean;
}
