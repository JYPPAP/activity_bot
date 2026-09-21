import { PostIntegrationRepository } from './forum/PostIntegrationRepository.js';
import { ForumMessageRepository } from './forum/ForumMessageRepository.js';
import { ForumParticipantRepository } from './forum/ForumParticipantRepository.js';
import { ForumWaitlistRepository } from './forum/ForumWaitlistRepository.js';

export class ForumRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
    this.postIntegrationRepository = new PostIntegrationRepository(dbManager);
    this.forumMessageRepository = new ForumMessageRepository(dbManager);
    this.forumParticipantRepository = new ForumParticipantRepository(dbManager);
    this.forumWaitlistRepository = new ForumWaitlistRepository(dbManager);
    this.forumMessageRepository.setParent(this);
  }

  createPostIntegration(...args) { return this.postIntegrationRepository.createPostIntegration(...args); }
  getPostIntegration(...args) { return this.postIntegrationRepository.getPostIntegration(...args); }
  deactivatePostIntegration(...args) { return this.postIntegrationRepository.deactivatePostIntegration(...args); }
  addForumMessageId(...args) { return this.postIntegrationRepository.addForumMessageId(...args); }
  getForumMessageIds(...args) { return this.postIntegrationRepository.getForumMessageIds(...args); }
  getOrCreateForumRecord(...args) { return this.postIntegrationRepository.getOrCreateForumRecord(...args); }
  createDefaultForumRecord(...args) { return this.postIntegrationRepository.createDefaultForumRecord(...args); }
  linkVoiceChannel(...args) { return this.postIntegrationRepository.linkVoiceChannel(...args); }
  setStandaloneMode(...args) { return this.postIntegrationRepository.setStandaloneMode(...args); }
  ensureForumMapping(...args) { return this.postIntegrationRepository.ensureForumMapping(...args); }
  getActiveMappingsByForumState(...args) { return this.postIntegrationRepository.getActiveMappingsByForumState(...args); }
  getForumPostInfo(...args) { return this.postIntegrationRepository.getForumPostInfo(...args); }
  saveChannelMapping(...args) { return this.postIntegrationRepository.saveChannelMapping(...args); }
  getChannelMapping(...args) { return this.postIntegrationRepository.getChannelMapping(...args); }
  removeChannelMapping(...args) { return this.postIntegrationRepository.removeChannelMapping(...args); }
  updateLastParticipantCount(...args) { return this.postIntegrationRepository.updateLastParticipantCount(...args); }
  getAllChannelMappings(...args) { return this.postIntegrationRepository.getAllChannelMappings(...args); }
  trackForumMessage(...args) { return this.forumMessageRepository.trackForumMessage(...args); }
  getTrackedMessages(...args) { return this.forumMessageRepository.getTrackedMessages(...args); }
  clearTrackedMessages(...args) { return this.forumMessageRepository.clearTrackedMessages(...args); }
  ensureForumParticipantsTable(...args) { return this.forumParticipantRepository.ensureForumParticipantsTable(...args); }
  addParticipant(...args) { return this.forumParticipantRepository.addParticipant(...args); }
  removeParticipant(...args) { return this.forumParticipantRepository.removeParticipant(...args); }
  getParticipants(...args) { return this.forumParticipantRepository.getParticipants(...args); }
  getParticipantNicknames(...args) { return this.forumParticipantRepository.getParticipantNicknames(...args); }
  isParticipant(...args) { return this.forumParticipantRepository.isParticipant(...args); }
  getParticipantCount(...args) { return this.forumParticipantRepository.getParticipantCount(...args); }
  clearParticipants(...args) { return this.forumParticipantRepository.clearParticipants(...args); }
  getAllActiveParticipants(...args) { return this.forumParticipantRepository.getAllActiveParticipants(...args); }
  ensureForumWaitlistTable(...args) { return this.forumWaitlistRepository.ensureForumWaitlistTable(...args); }
  addToWaitlist(...args) { return this.forumWaitlistRepository.addToWaitlist(...args); }
  removeFromWaitlist(...args) { return this.forumWaitlistRepository.removeFromWaitlist(...args); }
  getWaitlistNicknames(...args) { return this.forumWaitlistRepository.getWaitlistNicknames(...args); }
  isInWaitlist(...args) { return this.forumWaitlistRepository.isInWaitlist(...args); }
  clearWaitlist(...args) { return this.forumWaitlistRepository.clearWaitlist(...args); }
}
