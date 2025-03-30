// src/commands/gapConfigCommand.js - gap_config 명령어
import { MessageFlags } from 'discord.js';
import { PATHS } from '../config/constants.js';
import { cleanRoleName } from '../utils/formatters.js';

export class GapConfigCommand {
  constructor(fileManager) {
    this.fileManager = fileManager;
  }

  /**
   * gap_config 명령어를 실행합니다.
   * @param {Interaction} interaction - 상호작용 객체
   */
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // 명령어 옵션 가져오기
      const role = cleanRoleName(interaction.options.getString("role"));
      const hours = interaction.options.getInteger("hours");
      
      // 역할 활동 설정 파일 로드
      const roleActivityConfig = this.fileManager.loadJSON(PATHS.ROLE_CONFIG);
      
      // 설정 업데이트
      roleActivityConfig[role] = hours;
      
      // 설정 저장
      this.fileManager.saveJSON(PATHS.ROLE_CONFIG, roleActivityConfig);
      
      // 응답 전송
      await interaction.followUp({
        content: `역할 ${role}의 최소 활동시간을 ${hours}시간으로 설정했습니다!`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('gap_config 명령어 실행 오류:', error);
      await interaction.followUp({
        content: '설정 저장 중 오류가 발생했습니다.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}