// src/commands/commandHandler.js - 명령어 핸들러
console.log('>>> commandHandler.js 파일이 로드되었습니다.');

import { PermissionsBitField, MessageFlags } from 'discord.js';
import { GapListCommand } from './gapListCommand.js';
import { GapConfigCommand } from './gapConfigCommand.js';
import { GapResetCommand } from './gapResetCommand.js';
import { GapCheckCommand } from './gapCheckCommand.js';
import { GapSaveCommand } from './gapSaveCommand.js';
import { GapCalendarCommand } from './gapCalendarCommand.js';
import { GapStatsCommand } from './gapStatsCommand.js'; // 새로운 통계 명령어 추가
// import { GapReportCommand } from './gapReportCommand.js'; // 새 명령어 추가
// import { GapCycleCommand } from './gapCycleCommand.js'; // 주기 설정 명령어 추가
import { config } from '../config/env.js';

export class CommandHandler {
  constructor(client, activityTracker, dbManager, calendarLogService) {
    this.client = client;
    this.activityTracker = activityTracker;
    this.dbManager = dbManager;
    this.calendarLogService = calendarLogService;

    // 사용 가능한 명령어 목록 초기화 (SQLite 사용하도록 변경)
    this.commands = new Map([
      ['gap_list', new GapListCommand(activityTracker, dbManager)],
      ['gap_config', new GapConfigCommand(dbManager)],
      ['gap_reset', new GapResetCommand(activityTracker)],
      ['gap_check', new GapCheckCommand(activityTracker, dbManager)],
      ['gap_save', new GapSaveCommand(activityTracker)],
      ['gap_calendar', new GapCalendarCommand(calendarLogService)],
      ['gap_stats', new GapStatsCommand(dbManager)] // 새로운 통계 명령어 추가
      // ['gap_report', new GapReportCommand(dbManager, activityTracker)], // 보고서 명령어 추가
      // ['gap_cycle', new GapCycleCommand(dbManager)] // 주기 설정 명령어 추가
    ]);
  }

  /**
   * 사용자가 관리자 권한을 가지고 있는지 확인합니다.
   * @param {Interaction} interaction - 상호작용 객체
   * @returns {boolean} - 관리자 권한 또는 특정 사용자 여부
   */
  hasAdminPermission(interaction) {
    return (
        interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
        interaction.user.id === config.ADMIN_ID ||
        interaction.user.id === config.DEV_ID
    );
  }

  /**
   * 명령어 상호작용을 처리합니다.
   * @param {Interaction} interaction - 상호작용 객체
   */
  async handleInteraction(interaction) {
    // 명령어 상호작용이 아닌 경우 무시
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    // 명령어 실행 권한 확인
    if (!this.hasAdminPermission(interaction)) {
      await interaction.reply({
        content: "이 명령어를 실행할 권한이 없습니다.(관리자용)",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // 명령어 실행
    try {
      // 해당 명령어 핸들러가 있는지 확인
      if (this.commands.has(commandName)) {
        await this.commands.get(commandName).execute(interaction);
      }
    } catch (error) {
      console.error("명령어 처리 오류:", error);

      // 이미 응답한 상호작용이 아닐 경우에만 응답
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "요청 수행 중 오류가 발생했습니다!",
          flags: MessageFlags.Ephemeral,
        });
      } else if (interaction.deferred) {
        await interaction.followUp({
          content: "요청 수행 중 오류가 발생했습니다!",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
}