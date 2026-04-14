// src/config/DiscordConstants.js - Discord 관련 상수
import { ChannelType } from 'discord.js';

export class DiscordConstants {
  // ========== 채널 타입 ==========
  static CHANNEL_TYPES = {
    GUILD_VOICE: ChannelType.GuildVoice,
    GUILD_FORUM: ChannelType.GuildForum
  };
  
  // ========== 커스텀 ID 접두사 ==========
  static CUSTOM_ID_PREFIXES = {
    VOICE_CONNECT: 'voice_connect_',
    VOICE_CLOSE: 'voice_close_',
    VOICE_SPECTATE: 'voice_spectate_',
    VOICE_WAIT: 'voice_wait_',
    VOICE_RESET: 'voice_reset_',
    VOICE_DELETE: 'voice_delete_',
    FORUM_PARTICIPATE: 'forum_participate_',
    FORUM_JOIN: 'forum_join_',
    FORUM_LEAVE: 'forum_leave_',
    RECRUITMENT_MODAL: 'recruitment_modal_',
    RECRUITMENT_METHOD: 'recruitment_method_',
    ROLE_BUTTON: 'role_btn_',
    ROLE_COMPLETE: 'role_complete_',
    STANDALONE_ROLE_BUTTON: 'standalone_role_btn_',
    STANDALONE_ROLE_COMPLETE: 'standalone_role_complete',
    EXISTING_POST_SELECT: 'existing_post_select_',
    SCRIMMAGE_RECRUITMENT: 'scrimmage_recruitment_',
    LONG_TERM_RECRUITMENT: 'long_term_recruitment_',
    FORUM_EDIT_PREMEMBERS: 'forum_edit_premembers_',  // format: forum_edit_premembers_{threadId}_{recruiterId}
    PREMEMBERS_EDIT_MODAL: 'premembers_edit_modal_',  // format: premembers_edit_modal_{threadId}
  };
  
  // ========== 메서드 값 ==========
  static METHOD_VALUES = {
    NEW_FORUM: 'new_forum',
    NEW_FORUM_PREFIX: 'new_forum_',
    EXISTING_FORUM: 'existing_forum',
    EXISTING_FORUM_PREFIX: 'existing_forum_'
  };
  
  // ========== 이모지 ==========
  static EMOJIS = {
    VOICE: '🔊',
    PARTICIPANTS: '👥',
    TIME: '⏰',
    LINK: '🔗',
    TARGET: '🎯',
    USER: '👤',
    TAGS: '🏷️',
    DESCRIPTION: '📝',
    RECRUITER: '👤',
    GAME: '🎮',
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    SPECTATOR: '👁️',
    RESET: '🔄',
    CONNECT: '🎯',
    CLOSE: '🔒'
  };
  
  // ========== 특수 태그 ==========
  static SPECIAL_TAGS = {
    WAITING: '[대기]',
    SPECTATING: '[관전]'
  };
  
  // ========== Discord 제한사항 ==========
  static LIMITS = {
    EMBED_DESCRIPTION_MAX: 4096,
    EMBED_FIELD_VALUE_MAX: 1024,
    EMBED_TITLE_MAX: 256,
    MODAL_TITLE_MAX: 100,
    MODAL_DESCRIPTION_MAX: 1000,
    BUTTON_LABEL_MAX: 80,
    SELECT_OPTION_LABEL_MAX: 100
  };
}