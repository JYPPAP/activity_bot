import { ForumPostCreator } from './forum/ForumPostCreator.js';
import { ForumPostBuilders } from './forum/ForumPostBuilders.js';
import { ForumPostNotifier } from './forum/ForumPostNotifier.js';
import { ForumPostQueries } from './forum/ForumPostQueries.js';
import { ForumMessageTracker } from './forum/ForumMessageTracker.js';

export class ForumPostManager {
  constructor(client, forumChannelId, forumTagId, databaseManager = null) {
    this.client = client;
    this.forumChannelId = forumChannelId;
    this.forumTagId = forumTagId;
    this.databaseManager = databaseManager;

    const deps = { client, forumChannelId, forumTagId, databaseManager, parent: this };
    this.builders = new ForumPostBuilders(deps);
    this.tracker = new ForumMessageTracker(deps);
    this.queries = new ForumPostQueries(deps);
    this.notifier = new ForumPostNotifier(deps);
    this.creator = new ForumPostCreator(deps);
  }

  createForumPost(recruitmentData, voiceChannelId = null, specialType = null) {
    return this.creator.createForumPost(recruitmentData, voiceChannelId, specialType);
  }

  sendEmojiParticipantUpdate(postId, participants, emojiName = '참가') {
    return this.notifier.sendEmojiParticipantUpdate(postId, participants, emojiName);
  }

  sendWaitlistUpdate(postId, waitlist = []) {
    return this.notifier.sendWaitlistUpdate(postId, waitlist);
  }

  getPostInfo(postId) {
    return this.queries.getPostInfo(postId);
  }

  archivePost(postId, reason = '음성 채널 삭제됨', lockThread = true) {
    return this.queries.archivePost(postId, reason, lockThread);
  }

  sendParticipantChangeNotification(postId, joinedUsers = [], leftUsers = []) {
    return this.notifier.sendParticipantChangeNotification(postId, joinedUsers, leftUsers);
  }

  sendVoiceChannelLinkMessage(postId, voiceChannelName, voiceChannelId, guildId, linkerId) {
    return this.notifier.sendVoiceChannelLinkMessage(postId, voiceChannelName, voiceChannelId, guildId, linkerId);
  }

  sendParticipantUpdateMessage(postId, currentCount, maxCount, voiceChannelName) {
    return this.notifier.sendParticipantUpdateMessage(postId, currentCount, maxCount, voiceChannelName);
  }

  postExists(postId) {
    return this.queries.postExists(postId);
  }

  getExistingPostsFilteredByUser(limit = 15, userDisplayName = null) {
    return this.queries.getExistingPostsFilteredByUser(limit, userDisplayName);
  }

  generatePostTitle(recruitmentData) {
    return this.builders.generatePostTitle(recruitmentData);
  }

  createParticipationButtons(threadId) {
    return this.builders.createParticipationButtons(threadId);
  }

  createRecruiterButtons(threadId, recruiterId = 'temp', includeClose = true) {
    return this.builders.createRecruiterButtons(threadId, recruiterId, includeClose);
  }
}
