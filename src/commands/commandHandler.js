// src/commands/commandHandler.js - 명령어 핸들러 수정
import {PermissionsBitField, MessageFlags, ApplicationCommandOptionType} from 'discord.js';
import {hasCommandPermission, getPermissionDeniedMessage} from '../config/commandPermissions.js';
import {config} from '../config/env.js';
import {SafeInteraction} from '../utils/SafeInteraction.js';
import { logger } from '../config/logger-termux.js';

export class CommandHandler {
  constructor(client, activityTracker, dbManager, voiceChannelForumIntegrationService, userClassificationService,
              gapConfigCommand, timeConfirmCommand, timeCheckCommand, gapReportCommand, gapAfkCommand,
              recruitmentCommand, nicknameCommand, nicknameSetupCommand, nicknameManagementCommand) {
    this.client = client;
    this.activityTracker = activityTracker;
    this.dbManager = dbManager;
    this.voiceChannelForumIntegrationService = voiceChannelForumIntegrationService;
    this.userClassificationService = userClassificationService;

    this.commands = new Map();

    // 명령어들을 DI Container에서 주입받아 사용
    try {
      // UserClassificationService 의존성 주입 (필요시)
      if (gapReportCommand.setUserClassificationService) {
        gapReportCommand.setUserClassificationService(this.userClassificationService);
      }

      // 명령어 맵에 등록 (DI Container에서 주입받은 인스턴스들 사용)
      this.commands.set('gap_config', gapConfigCommand);
      this.commands.set('시간확인', timeConfirmCommand);
      this.commands.set('시간체크', timeCheckCommand);
      this.commands.set('보고서', gapReportCommand);
      this.commands.set('gap_afk', gapAfkCommand);
      this.commands.set('구직', recruitmentCommand);
      this.commands.set('닉네임설정', nicknameSetupCommand);
      this.commands.set('닉네임관리', nicknameManagementCommand);

      logger.info('명령어 초기화 완료', { component: 'CommandHandler', commands: [...this.commands.keys()], count: this.commands.size });
    } catch (error) {
      logger.error('명령어 초기화 오류', { component: 'CommandHandler', error: error.message, stack: error.stack });
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
    // 명령어 상호작용인 경우 명령어 처리
    if (interaction.isCommand()) {
      await this.handleCommandInteraction(interaction);
      return;
    }
    
    // 기타 인터랙션 (버튼, 모달, 셀렉트 메뉴 등)은 voiceForumService로 전달
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await this.voiceChannelForumIntegrationService.handleInteraction(interaction);
      return;
    }
  }
  
  /**
   * 명령어 인터랙션 처리
   * @param interaction - 명령어 인터랙션 객체
   */
  async handleCommandInteraction(interaction) {

    const {commandName} = interaction;

    // 권한 확인
    if (!hasCommandPermission(interaction.member, commandName)) {
      await SafeInteraction.safeReply(interaction, {
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
      logger.error('명령어 처리 오류', { component: 'CommandHandler', commandName: interaction.commandName, error: error.message, stack: error.stack, userId: interaction.user.id });

      // SafeInteraction이 자동으로 상태를 확인하고 적절한 메서드를 선택
      await SafeInteraction.safeReply(interaction, {
        content: "요청 수행 중 오류가 발생했습니다!",
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}