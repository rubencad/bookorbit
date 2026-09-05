import { Module } from '@nestjs/common';

import { BasicCredentialCache } from './auth/basic-credential-cache';
import { PermissionService } from './services/permission.service';
import { AuthenticationPolicyService } from './services/authentication-policy.service';

@Module({
  providers: [PermissionService, AuthenticationPolicyService, BasicCredentialCache],
  exports: [PermissionService, AuthenticationPolicyService, BasicCredentialCache],
})
export class CommonModule {}
