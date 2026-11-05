import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from './dto';
import { CurrentApiKey, RequireRole, RequireUnscopedKey } from './decorators/auth.decorators';
import { ApiKey, ApiKeyRole } from './entities/api-key.entity';
import { User } from './entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';

@ApiTags('auth')
@Controller('auth/users')
@RequireUnscopedKey()
export class UsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  private toResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private auditContext(req: Request, actor?: ApiKey) {
    return {
      apiKey: actor,
      ipAddress: (req as Request & { clientIp?: string }).clientIp ?? undefined,
      method: req.method,
      path: req.path,
    };
  }

  @Post()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Create a dashboard user (admin only)' })
  @ApiResponse({ status: 201, description: 'User created.', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 409, description: 'Username or email already in use.' })
  async create(
    @Body() dto: CreateUserDto,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<UserResponseDto> {
    const user = await this.authService.createUser(dto);
    await this.auditService.logInfo(AuditAction.USER_CREATED, {
      ...this.auditContext(req, actor),
      metadata: { targetUserId: user.id, username: user.username, role: user.role },
    });
    return this.toResponse(user);
  }

  @Get()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'List dashboard users (admin only)' })
  @ApiResponse({ status: 200, description: 'All users (never includes a password hash).', type: [UserResponseDto] })
  async findAll(): Promise<UserResponseDto[]> {
    return (await this.authService.findAllUsers()).map(user => this.toResponse(user));
  }

  @Get(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get a dashboard user (admin only)' })
  @ApiResponse({ status: 200, description: 'The user (never includes a password hash).', type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'No user with this id.' })
  async findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.toResponse(await this.authService.findUser(id));
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update a dashboard user (admin only)' })
  @ApiResponse({ status: 200, description: 'The updated user.', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed.' })
  @ApiResponse({ status: 404, description: 'No user with this id.' })
  @ApiResponse({ status: 409, description: 'Username or email already in use.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
    @CurrentApiKey() actor?: ApiKey,
  ): Promise<UserResponseDto> {
    const user = await this.authService.updateUser(id, dto);
    await this.auditService.logInfo(AuditAction.USER_UPDATED, {
      ...this.auditContext(req, actor),
      metadata: { targetUserId: user.id, username: user.username, role: user.role, isActive: user.isActive },
    });
    return this.toResponse(user);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a dashboard user (admin only)' })
  @ApiResponse({ status: 204, description: 'User deleted.' })
  @ApiResponse({ status: 404, description: 'No user with this id.' })
  @ApiResponse({ status: 409, description: 'The user is the last active admin account.' })
  async delete(@Param('id') id: string, @Req() req: Request, @CurrentApiKey() actor?: ApiKey): Promise<void> {
    const user = await this.authService.findUser(id);
    await this.authService.deleteUser(id);
    await this.auditService.logInfo(AuditAction.USER_DELETED, {
      ...this.auditContext(req, actor),
      metadata: { targetUserId: id, username: user.username },
    });
  }
}
