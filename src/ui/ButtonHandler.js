// src/ui/ButtonHandler.js - 버튼 인터랙션 라우팅 Facade
import { config } from '../config/env.js';
import { logger } from '../config/logger-termux.js';
import { RoleTagButtons } from './buttons/RoleTagButtons.js';
import { VoiceChannelButtons } from './buttons/VoiceChannelButtons.js';
import { ForumPostButtons } from './buttons/ForumPostButtons.js';
import { PreMembersButtons } from './buttons/PreMembersButtons.js';

export class ButtonHandler {
  constructor(voiceChannelManager, recruitmentService, modalHandler, emojiReactionService, forumPostManager) {
    this.voiceChannelManager = voiceChannelManager;
    this.recruitmentService = recruitmentService;
    this.modalHandler = modalHandler;
    this.emojiReactionService = emojiReactionService;
    this.forumPostManager = forumPostManager;

    const deps = {
      voiceChannelManager,
      recruitmentService,
      modalHandler,
      emojiReactionService,
      forumPostManager,
      parent: this,
    };

    this.roleTagButtons = new RoleTagButtons(deps);
    this.voiceChannelButtons = new VoiceChannelButtons(deps);
    this.forumPostButtons = new ForumPostButtons(deps);
    this.preMembersButtons = new PreMembersButtons(deps);
  }

  async handleRoleTagButtons(interaction) {
    return this.roleTagButtons.handleRoleTagButtons(interaction);
  }

  async handlePreMembersSelectMenu(interaction) {
    return this.preMembersButtons.handlePreMembersSelectMenu(interaction);
  }

  async routeButtonInteraction(interaction) {
    const customId = interaction.customId;

    if (this.roleTagButtons.isRoleTagButton(customId)) {
      await this.handleRoleTagButtons(interaction);
    } else if (this.voiceChannelButtons.isVoiceChannelButton(customId)) {
      await this.voiceChannelButtons.handleVoiceChannelButtons(interaction);
    } else if (this.isRecruitmentOptionsButton(customId)) {
      await this.handleRecruitmentOptionsButton(interaction);
    } else {
      logger.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);
    }
  }

  isRecruitmentOptionsButton(customId) {
    return customId.startsWith('recruitment_options_');
  }

  async handleRecruitmentOptionsButton(interaction) {
    const customId = interaction.customId;
    const channelId = customId.split('_')[2];

    if (config.EXCLUDED_CHANNELS.includes(channelId)) {
      return;
    }

    logger.warn(`[ButtonHandler] 처리되지 않은 버튼: ${customId}`);
  }
}
