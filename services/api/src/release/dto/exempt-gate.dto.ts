import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 豁免指定 Gate 的入参（KI-020 修复：必须提供原因并写入审计）。
 *
 * 业务约束：
 * - reason：豁免原因，必填，长度 ≤ 500；写审计并展示给发布人。
 * - ticket：可选外部工单/审批单号，便于追溯。
 */
export class ExemptGateDto {
  @IsString({ message: '豁免原因必须是字符串' })
  @IsNotEmpty({ message: '豁免原因不能为空' })
  @MaxLength(500, { message: '豁免原因不能超过 500 字符' })
  reason!: string;

  @IsOptional()
  @IsString({ message: '外部工单号必须是字符串' })
  @MaxLength(100, { message: '外部工单号不能超过 100 字符' })
  ticket?: string;
}
