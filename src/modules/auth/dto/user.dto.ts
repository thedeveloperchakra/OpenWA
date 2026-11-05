import { IsString, IsOptional, IsEnum, IsBoolean, IsEmail, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ToStrictBoolean, ToStrictString } from '../../../common/utils/strict-boolean';
import { MaxCodePoints } from '../../../common/validation/max-code-points';
import { ApiKeyRole } from '../entities/api-key.entity';

const USERNAME_MIN = 3;
const USERNAME_MAX = 50;
const EMAIL_MAX = 255;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

export class LoginDto {
  @ApiProperty({
    description: 'Username or email of the account',
    example: 'admin',
    minLength: 1,
    maxLength: 255,
  })
  @ToStrictString()
  @IsString()
  @MinLength(1)
  @MaxCodePoints(255)
  identifier!: string;

  @ApiProperty({ description: 'Account password', example: 'correct horse battery staple', minLength: 1 })
  @ToStrictString()
  @IsString()
  @MinLength(1)
  @MaxCodePoints(PASSWORD_MAX)
  password!: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'API key to send as X-API-Key (or Authorization: Bearer) on later requests.' })
  apiKey!: string;

  @ApiProperty({ enum: ApiKeyRole })
  role!: ApiKeyRole;

  @ApiPropertyOptional({ description: 'Engine the process resolved at boot.', example: 'baileys' })
  engineType?: string;

  @ApiProperty({ description: 'Whether the key is restricted to selected sessions.', example: false })
  scoped!: boolean;
}

export class CreateUserDto {
  @ApiProperty({ example: 'jane', minLength: USERNAME_MIN, maxLength: USERNAME_MAX })
  @ToStrictString()
  @IsString()
  @MinLength(USERNAME_MIN)
  @MaxCodePoints(USERNAME_MAX)
  username!: string;

  @ApiProperty({ example: 'jane@example.com', maxLength: EMAIL_MAX })
  @ToStrictString()
  @IsEmail()
  @MaxCodePoints(EMAIL_MAX)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple', minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @ToStrictString()
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxCodePoints(PASSWORD_MAX)
  password!: string;

  @ApiPropertyOptional({ enum: ApiKeyRole, default: ApiKeyRole.OPERATOR })
  @IsOptional()
  @IsEnum(ApiKeyRole)
  role?: ApiKeyRole;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserDto {
  @ApiPropertyOptional({ minLength: USERNAME_MIN, maxLength: USERNAME_MAX })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MinLength(USERNAME_MIN)
  @MaxCodePoints(USERNAME_MAX)
  username?: string;

  @ApiPropertyOptional({ maxLength: EMAIL_MAX })
  @IsOptional()
  @ToStrictString()
  @IsEmail()
  @MaxCodePoints(EMAIL_MAX)
  email?: string;

  @ApiPropertyOptional({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX })
  @IsOptional()
  @ToStrictString()
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxCodePoints(PASSWORD_MAX)
  password?: string;

  @ApiPropertyOptional({ enum: ApiKeyRole })
  @IsOptional()
  @IsEnum(ApiKeyRole)
  role?: ApiKeyRole;

  @ApiPropertyOptional()
  @IsOptional()
  @ToStrictBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class UserResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ApiKeyRole })
  role!: ApiKeyRole;

  @ApiProperty()
  isActive!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  lastLoginAt?: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}
