// src/types/discord.ts - Discord.js 확장 타입 정의

import {
  Client,
  Guild,
  GuildMember,
  User,
  VoiceState,
  TextChannel,
  VoiceChannel,
  CategoryChannel,
  ForumChannel,
  ThreadChannel,
  Message,
  ButtonInteraction,
  ModalSubmitInteraction,
  ChatInputCommandInteraction,
  SelectMenuInteraction,
  InteractionResponse,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  SlashCommandBuilder,
  PermissionsBitField,
  Collection,
  ActivityType,
  PresenceStatus,
  Events,
  RESTPostAPIApplicationCommandsJSONBody,
} from 'discord.js';

import { ServiceDependencies } from './index.js';

// ====================
// 확장된 Discord.js 타입
// ====================

export interface ExtendedClient extends Client {
  commands: Collection<string, BotCommand>;
  services: ServiceDependencies;
  isReady: boolean;
}

export interface ExtendedGuild extends Guild {
  getBotMember(): GuildMember | null;
  getLogChannel(): TextChannel | null;
  getCalendarLogChannel(): TextChannel | null;
  getForumChannel(): ForumChannel | null;
  getVoiceCategory(): CategoryChannel | null;
}

export interface ExtendedGuildMember extends GuildMember {
  hasRequiredRole(roleName: string): boolean;
  getActivityTime(): Promise<number>;
  isExcludedFromTracking(): boolean;
  getDisplayName(): string;
}

export interface ExtendedUser extends User {
  getGuildMember(guildId: string): Promise<GuildMember | null>;
  isBot(): boolean;
  isDeveloper(): boolean;
}

export interface ExtendedVoiceState extends VoiceState {
  isValidForTracking(): boolean;
  getChannelName(): string | null;
  hasValidChannel(): boolean;
}

// ====================
// 봇 명령어 타입
// ====================

export interface BotCommand {
  data: SlashCommandBuilder | RESTPostAPIApplicationCommandsJSONBody;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  cooldown?: number;
  permissions?: PermissionsBitField;
  guildOnly?: boolean;
  ownerOnly?: boolean;
  category?: CommandCategory;
  description?: string;
  usage?: string;
  examples?: string[];
}

export type CommandCategory = 
  | 'activity'
  | 'configuration'
  | 'utility'
  | 'moderation'
  | 'recruitment'
  | 'statistics'
  | 'admin';

export interface CommandOptions {
  name: string;
  description: string;
  category: CommandCategory;
  cooldown?: number;
  permissions?: PermissionsBitField;
  guildOnly?: boolean;
  ownerOnly?: boolean;
}

// ====================
// 인터랙션 타입
// ====================

export interface ExtendedChatInputCommandInteraction extends ChatInputCommandInteraction {
  services: ServiceDependencies;
  getUserMention(userId: string): string;
  getRoleMention(roleId: string): string;
  getChannelMention(channelId: string): string;
  sendEphemeralReply(content: string): Promise<InteractionResponse>;
  sendSuccessReply(content: string): Promise<InteractionResponse>;
  sendErrorReply(content: string): Promise<InteractionResponse>;
}

export interface ExtendedButtonInteraction extends ButtonInteraction {
  services: ServiceDependencies;
  getCustomId(): string;
  getComponentData(): Record<string, any>;
}

export interface ExtendedModalSubmitInteraction extends ModalSubmitInteraction {
  services: ServiceDependencies;
  getFieldValue(customId: string): string | null;
  getAllFieldValues(): Record<string, string>;
}

export interface ExtendedSelectMenuInteraction extends SelectMenuInteraction {
  services: ServiceDependencies;
  getSelectedValues(): string[];
  getFirstSelectedValue(): string | null;
}

// ====================
// 이벤트 타입
// ====================

export interface VoiceStateUpdateEvent {
  oldState: ExtendedVoiceState;
  newState: ExtendedVoiceState;
  member: ExtendedGuildMember;
  action: VoiceAction;
  timestamp: Date;
}

export type VoiceAction = 
  | 'join'
  | 'leave'
  | 'move'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'
  | 'disconnect';

export interface GuildMemberUpdateEvent {
  oldMember: ExtendedGuildMember;
  newMember: ExtendedGuildMember;
  changes: MemberChanges;
  timestamp: Date;
}

export interface MemberChanges {
  nickname?: {
    old: string | null;
    new: string | null;
  };
  roles?: {
    added: string[];
    removed: string[];
  };
  permissions?: {
    old: PermissionsBitField;
    new: PermissionsBitField;
  };
}

// ====================
// 메시지 및 임베드 타입
// ====================

export interface EmbedConfig {
  color?: number;
  title?: string;
  description?: string;
  fields?: EmbedFieldData[];
  footer?: EmbedFooterData;
  timestamp?: Date;
  thumbnail?: string;
  image?: string;
  author?: EmbedAuthorData;
}

export interface EmbedFieldData {
  name: string;
  value: string;
  inline?: boolean;
}

export interface EmbedFooterData {
  text: string;
  iconURL?: string;
}

export interface EmbedAuthorData {
  name: string;
  iconURL?: string;
  url?: string;
}

export interface ActivityEmbed extends EmbedConfig {
  userId: string;
  activityTime: number;
  status: ActivityStatus;
  lastUpdate: Date;
}

export type ActivityStatus = 
  | 'active'
  | 'inactive'
  | 'afk'
  | 'insufficient'
  | 'sufficient';

// ====================
// 컴포넌트 타입
// ====================

export interface ButtonConfig {
  customId: string;
  label: string;
  style: ButtonStyle;
  emoji?: string;
  disabled?: boolean;
  url?: string;
}

export type ButtonStyle = 
  | 'Primary'
  | 'Secondary'
  | 'Success'
  | 'Danger'
  | 'Link';

export interface SelectMenuConfig {
  customId: string;
  placeholder: string;
  options: SelectMenuOption[];
  minValues?: number;
  maxValues?: number;
  disabled?: boolean;
}

export interface SelectMenuOption {
  label: string;
  value: string;
  description?: string;
  emoji?: string;
  default?: boolean;
}

export interface ModalConfig {
  customId: string;
  title: string;
  components: ModalComponent[];
}

export interface ModalComponent {
  customId: string;
  label: string;
  style: TextInputStyle;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  value?: string;
}

export type TextInputStyle = 'Short' | 'Paragraph';

// ====================
// 채널 타입
// ====================

export interface ExtendedTextChannel extends TextChannel {
  sendActivityLog(content: string): Promise<Message>;
  sendCalendarLog(content: string): Promise<Message>;
  sendNotification(content: string): Promise<Message>;
  hasPermissionToSend(): boolean;
}

export interface ExtendedVoiceChannel extends VoiceChannel {
  isExcludedFromTracking(): boolean;
  getActiveMembers(): Collection<string, GuildMember>;
  getTotalMemberCount(): number;
  isValidForActivity(): boolean;
}

export interface ExtendedForumChannel extends ForumChannel {
  createRecruitmentPost(data: ForumPostData): Promise<ThreadChannel>;
  getActiveRecruitmentPosts(): Promise<Collection<string, ThreadChannel>>;
  hasRecruitmentTags(): boolean;
}

export interface ForumPostData {
  name: string;
  message: string;
  tags?: string[];
  reason?: string;
}

// ====================
// 권한 및 역할 타입
// ====================

export interface PermissionConfig {
  command: string;
  requiredPermissions: PermissionsBitField;
  requiredRoles: string[];
  allowedChannels: string[];
  ownerOnly: boolean;
  guildOnly: boolean;
}

export interface RoleHierarchy {
  roleId: string;
  roleName: string;
  position: number;
  permissions: PermissionsBitField;
  isHoisted: boolean;
  isMentionable: boolean;
  color: number;
}

// ====================
// 활동 추적 타입
// ====================

export interface VoiceActivityData {
  userId: string;
  channelId: string;
  joinTime: Date;
  leaveTime?: Date;
  duration?: number;
  isAfk: boolean;
  isDeafened: boolean;
  isMuted: boolean;
}

export interface UserPresenceData {
  userId: string;
  status: PresenceStatus;
  activities: ActivityData[];
  clientStatus: Record<string, PresenceStatus>;
  lastUpdate: Date;
}

export interface ActivityData {
  name: string;
  type: ActivityType;
  url?: string;
  details?: string;
  state?: string;
  timestamps?: {
    start?: Date;
    end?: Date;
  };
}

// ====================
// 메시지 필터 타입
// ====================

export interface MessageFilter {
  content?: string;
  authorId?: string;
  channelId?: string;
  guildId?: string;
  hasAttachments?: boolean;
  hasEmbeds?: boolean;
  mentionsEveryone?: boolean;
  mentionsRoles?: string[];
  mentionsUsers?: string[];
  isBot?: boolean;
  isWebhook?: boolean;
  isSystem?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
}

// ====================
// 로그 타입
// ====================

export interface DiscordLogEntry {
  id: string;
  type: LogType;
  guildId: string;
  userId?: string;
  channelId?: string;
  messageId?: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export type LogType = 
  | 'message_create'
  | 'message_update'
  | 'message_delete'
  | 'member_join'
  | 'member_leave'
  | 'member_update'
  | 'voice_state_update'
  | 'channel_create'
  | 'channel_update'
  | 'channel_delete'
  | 'role_create'
  | 'role_update'
  | 'role_delete'
  | 'ban_add'
  | 'ban_remove'
  | 'command_used'
  | 'error'
  | 'system';

// ====================
// 헬퍼 타입
// ====================

export interface DiscordAPIError {
  code: number;
  message: string;
  httpStatus: number;
  method: string;
  url: string;
  requestBody?: any;
}

export interface RateLimitData {
  timeout: number;
  limit: number;
  method: string;
  route: string;
  global: boolean;
}

// ====================
// 유틸리티 타입
// ====================

export type ChannelResolvable = 
  | string
  | TextChannel
  | VoiceChannel
  | ForumChannel
  | ThreadChannel;

export type UserResolvable = 
  | string
  | User
  | GuildMember;

export type RoleResolvable = 
  | string
  | Role;

export type GuildResolvable = 
  | string
  | Guild;

// ====================
// 이벤트 핸들러 타입
// ====================

export type EventHandler<T extends keyof Events> = (
  ...args: Parameters<Events[T]>
) => Promise<void> | void;

export interface EventListenerOptions {
  once?: boolean;
  prepend?: boolean;
}

// ====================
// 커스텀 이벤트 타입
// ====================

export interface CustomEvents {
  activityUpdate: [VoiceActivityData];
  memberActivityChange: [ExtendedGuildMember, number];
  roleConfigUpdate: [string, number];
  afkStatusChange: [ExtendedGuildMember, boolean];
  recruitmentPostCreated: [ThreadChannel];
  recruitmentPostClosed: [ThreadChannel];
  systemError: [Error, string];
  debugLog: [string, any];
}

// ====================
// 타입 가드 함수
// ====================

export function isTextChannel(channel: any): channel is TextChannel {
  return channel && channel.type === 0; // ChannelType.GuildText
}

export function isVoiceChannel(channel: any): channel is VoiceChannel {
  return channel && channel.type === 2; // ChannelType.GuildVoice
}

export function isForumChannel(channel: any): channel is ForumChannel {
  return channel && channel.type === 15; // ChannelType.GuildForum
}

export function isThreadChannel(channel: any): channel is ThreadChannel {
  return channel && (channel.type === 11 || channel.type === 12); // ChannelType.GuildPublicThread or GuildPrivateThread
}

export function isChatInputCommandInteraction(
  interaction: any
): interaction is ChatInputCommandInteraction {
  return interaction && interaction.isChatInputCommand && interaction.isChatInputCommand();
}

export function isButtonInteraction(
  interaction: any
): interaction is ButtonInteraction {
  return interaction && interaction.isButton && interaction.isButton();
}

export function isModalSubmitInteraction(
  interaction: any
): interaction is ModalSubmitInteraction {
  return interaction && interaction.isModalSubmit && interaction.isModalSubmit();
}

export function isSelectMenuInteraction(
  interaction: any
): interaction is SelectMenuInteraction {
  return interaction && interaction.isStringSelectMenu && interaction.isStringSelectMenu();
}