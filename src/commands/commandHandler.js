// src/commands/commandHandler.js - 명령어 핸들러 수정
import {PermissionsBitField, MessageFlags, ApplicationCommandOptionType} from 'discord.js';
import {GapListCommand} from './gapListCommand.js';
import {GapConfigCommand} from './gapConfigCommand.js';
import {GapResetCommand} from './gapResetCommand.js';
import {GapCheckCommand} from './gapCheckCommand.js';
import {GapSaveCommand} from './gapSaveCommand.js';
import {GapCalendarCommand} from './gapCalendarCommand.js';
import {GapStatsCommand} from './gapStatsCommand.js';
import {GapReportCommand} from './gapReportCommand.js';
import {GapCycleCommand} from './gapCycleCommand.js';
import {GapAfkCommand} from './gapAfkCommand.js';
import {RecruitmentCommand} from './recruitmentCommand.js';
import {UserClassificationService} from '../services/UserClassificationService.js';
import {hasCommandPermission, getPermissionDeniedMessage} from '../config/commandPermissions.js';
import {config} from '../config/env.js';

export class CommandHandler {
  constructor(client, activityTracker, dbManager, calendarLogService, voiceForumService) {
    this.client = client;
    this.activityTracker = activityTracker;
    this.dbManager = dbManager;
    this.calendarLogService = calendarLogService;
    this.voiceForumService = voiceForumService;

    // UserClassificationService 인스턴스 생성
    this.userClassificationService = new UserClassificationService(this.dbManager, this.activityTracker);

    this.commands = new Map();

    // 각 명령어 개별적으로 추가
    try {
      // 명령어 인스턴스 생성
      const gapListCommand = new GapListCommand(this.activityTracker, this.dbManager);
      const gapConfigCommand = new GapConfigCommand(this.dbManager);
      const gapResetCommand = new GapResetCommand(this.activityTracker);
      const gapCheckCommand = new GapCheckCommand(this.activityTracker, this.dbManager);
      const gapSaveCommand = new GapSaveCommand(this.activityTracker);
      const gapCalendarCommand = new GapCalendarCommand(this.calendarLogService);
      const gapStatsCommand = new GapStatsCommand(this.dbManager);
      const gapReportCommand = new GapReportCommand(this.dbManager, this.activityTracker);
      const gapCycleCommand = new GapCycleCommand(this.dbManager);
      const gapAfkCommand = new GapAfkCommand(this.client, this.dbManager);
      const recruitmentCommand = new RecruitmentCommand({
        client: this.client,
        voiceForumService: this.voiceForumService
      });

      // UserClassificationService 의존성 주입
      if (gapListCommand.setUserClassificationService) {
        gapListCommand.setUserClassificationService(this.userClassificationService);
      }

      if (gapReportCommand.setUserClassificationService) {
        gapReportCommand.setUserClassificationService(this.userClassificationService);
      }

      // 명령어 맵에 등록
      this.commands.set('gap_list', gapListCommand);
      this.commands.set('gap_config', gapConfigCommand);
      this.commands.set('gap_reset', gapResetCommand);
      this.commands.set('시간체크', gapCheckCommand);
      this.commands.set('gap_save', gapSaveCommand);
      this.commands.set('gap_calendar', gapCalendarCommand);
      this.commands.set('gap_stats', gapStatsCommand);
      this.commands.set('gap_report', gapReportCommand);
      this.commands.set('gap_cycle', gapCycleCommand);
      this.commands.set('gap_afk', gapAfkCommand);
      this.commands.set('구직', recruitmentCommand);

      console.log('명령어 초기화 완료:', [...this.commands.keys()]);
    } catch (error) {
      console.error('명령어 초기화 오류:', error);
    }
  }

  /**
   * 사용자가 관리자 권한을 가지고 있는지 확인합니다.
   * @param interaction - 상호작용 객체
   * @returns {boolean} - 관리자 권한 또는 특정 사용자 여부
   */
  hasAdminPermission(interaction) {
    return (
      interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      interaction.user.id === config.DEV_ID
    );
  }

  /**
   * 명령어 상호작용을 처리합니다.
   * @param interaction - 상호작용 객체
   */
  async handleInteraction(interaction) {
    // 명령어 상호작용이 아닌 경우 무시
    if (!interaction.isCommand()) return;

    const {commandName} = interaction;

    // 권한 확인
    if (!hasCommandPermission(interaction.member, commandName)) {
      await interaction.reply({
        content: getPermissionDeniedMessage(commandName),
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