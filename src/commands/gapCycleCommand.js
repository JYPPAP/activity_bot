// src/commands/gapCycleCommand.js - gap_cycle 명령어
import {MessageFlags} from 'discord.js';
import {cleanRoleName} from '../utils/formatters.js';

export class GapCycleCommand {
  constructor(dbManager) {
    this.db = dbManager;
  }

  /**
   * gap_cycle 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    try {
      // 역할 옵션 가져오기
      const role = cleanRoleName(interaction.options.getString("role"));

      // 주기 옵션 가져오기
      const cycle = interaction.options.getInteger("cycle");

      // 역할 설정 확인
      const roleConfig = await this.db.getRoleConfig(role);
      if (!roleConfig) {
        return await interaction.followUp({
          content: `역할 "${role}"에 대한 설정을 찾을 수 없습니다. 먼저 /gap_config 명령어로 설정해주세요.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      // 역할 보고서 주기 업데이트
      await this.db.updateRoleReportCycle(role, cycle);

      // 다음 보고서 예정 시간 가져오기
      const nextReportTime = await this.db.getNextReportTime(role);
      const nextReportDate = new Date(nextReportTime);

      // 응답 전송
      let cycleText;
      switch (cycle) {
      case 1:
        cycleText = '매주';
        break;
      case 2:
        cycleText = '격주';
        break;
      case 4:
        cycleText = '월간';
        break;
      default:
        cycleText = `${cycle}주마다`;
      }

      await interaction.followUp({
        content: `✅ 역할 "${role}"의 보고서 출력 주기가 ${cycleText}로 설정되었습니다.\n다음 예정 보고서: ${nextReportDate.toLocaleString('ko-KR')}`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('gap_cycle 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '주기 설정 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}