import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateKomgaUserDto {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsBoolean()
  groupUnknownSeries?: boolean;

  @IsOptional()
  @IsBoolean()
  includeNonComicBooks?: boolean;
}
