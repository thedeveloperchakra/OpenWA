import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto } from './dto';
import { Public } from './decorators/auth.decorators';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { EngineFactory } from '../../engine/engine.factory';

@ApiTags('auth')
@Controller('auth')
export class AuthLoginController {
  constructor(
    private readonly authService: AuthService,
    private readonly engineFactory: EngineFactory,
    private readonly auditService: AuditService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with a username or email and password' })
  @ApiResponse({ status: 200, description: 'Signed in; use the returned apiKey as X-API-Key.', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid credentials, or the account is disabled.' })
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResponseDto> {
    const { apiKey, rawKey, user } = await this.authService.login(dto.identifier.trim(), dto.password);

    await this.auditService.logInfo(AuditAction.USER_LOGIN, {
      ipAddress: (req as Request & { clientIp?: string }).clientIp,
      method: req.method,
      path: req.path,
      metadata: { userId: user.id, username: user.username },
    });

    return {
      apiKey: rawKey,
      role: apiKey.role,
      engineType: this.engineFactory.getCurrentEngine(),
      scoped: (apiKey.allowedSessions?.length ?? 0) > 0,
    };
  }
}
