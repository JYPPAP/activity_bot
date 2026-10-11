export class OnboardingRepository {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }

  async getConfig(guildId) {
    const result = await this.dbManager.query(
      'SELECT * FROM onboarding_configs WHERE guild_id = $1', [guildId]
    );
    return result.rows[0] || null;
  }

  async saveConfig(guildId, config) {
    const result = await this.dbManager.query(`
      INSERT INTO onboarding_configs (
        guild_id, welcome_channel_id, category_id, review_channel_id, gender_male_role_id,
        gender_female_role_id, pending_role_id, member_role_id, rules_text, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
      ON CONFLICT (guild_id) DO UPDATE SET
        welcome_channel_id=EXCLUDED.welcome_channel_id, category_id=EXCLUDED.category_id,
        review_channel_id=EXCLUDED.review_channel_id, gender_male_role_id=EXCLUDED.gender_male_role_id,
        gender_female_role_id=EXCLUDED.gender_female_role_id, rules_text=EXCLUDED.rules_text,
        pending_role_id=EXCLUDED.pending_role_id, member_role_id=EXCLUDED.member_role_id,
        enabled=true, updated_at=CURRENT_TIMESTAMP
      RETURNING *`, [guildId, config.welcomeChannelId, config.categoryId, config.reviewChannelId,
      config.maleRoleId, config.femaleRoleId, config.pendingRoleId, config.memberRoleId,
      config.rulesText]);
    return result.rows[0];
  }

  async addGameRole(guildId, label, roleId) {
    const result = await this.dbManager.query(`
      UPDATE onboarding_configs
      SET game_roles = (
            SELECT COALESCE(jsonb_agg(role), '[]'::jsonb)
            FROM jsonb_array_elements(game_roles) AS role
            WHERE role->>'roleId' <> $3
              AND role->>'label' <> $2
          ) || jsonb_build_array(jsonb_build_object('label', $2, 'roleId', $3)),
          updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = $1
        AND $3 NOT IN (gender_male_role_id, gender_female_role_id, pending_role_id, member_role_id)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each_text(COALESCE(stage_role_ids, '{}'::jsonb)) AS stage_role
          WHERE stage_role.value = $3
        )
        AND (SELECT COUNT(*) FROM jsonb_array_elements(game_roles) AS role
             WHERE role->>'roleId' <> $3 AND role->>'label' <> $2) < 25
      RETURNING game_roles`, [guildId, label, roleId]);

    if (!result.rows[0]) {
      throw new Error('가입관리 설정, 역할 중복 또는 게임 선택지 제한(최대 25개)을 확인해 주세요.');
    }

    return result.rows[0].game_roles;
  }

  async ensureProgress(guildId, userId) {
    const result = await this.dbManager.query(`
      INSERT INTO onboarding_progress (guild_id, user_id) VALUES ($1,$2)
      ON CONFLICT (guild_id,user_id) DO UPDATE SET user_id=EXCLUDED.user_id
      RETURNING *`, [guildId, userId]);
    return result.rows[0];
  }

  async saveProgress(guildId, userId, patch) {
    const columns = {
      stage: 'stage', genderRoleId: 'gender_role_id', gameRoleIds: 'game_role_ids',
      rulesAcceptedAt: 'rules_accepted_at', appliedAt: 'applied_at', reviewedAt: 'reviewed_at',
      reviewedBy: 'reviewed_by', rejectionReason: 'rejection_reason', channelId: 'channel_id',
      messageId: 'message_id', reviewMessageId: 'review_message_id', cleanupAt: 'cleanup_at',
      reviewAction: 'review_action', departedAt: 'departed_at', ruleIndex: 'rule_index',
      rulesRevision: 'rules_revision'
    };
    const parameters = [guildId, userId];
    const assignments = [];
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(columns, key)) throw new Error(`Unknown onboarding progress field: ${key}`);
      if (value === undefined) continue;
      parameters.push(key === 'gameRoleIds' && value !== null ? JSON.stringify(value) : value);
      assignments.push(`${columns[key]}=$${parameters.length}${key === 'gameRoleIds' ? '::jsonb' : ''}`);
    }
    if (!assignments.length) return this.getProgress(guildId, userId);
    const result = await this.dbManager.query(`
      UPDATE onboarding_progress SET ${assignments.join(', ')}, updated_at=CURRENT_TIMESTAMP
      WHERE guild_id=$1 AND user_id=$2 RETURNING *`, parameters);
    return result.rows[0] || null;
  }

  async saveWelcomeMessage(guildId, messageId) {
    const result = await this.dbManager.query(`
      UPDATE onboarding_configs SET welcome_message_id=$2, updated_at=CURRENT_TIMESTAMP
      WHERE guild_id=$1 RETURNING *`, [guildId, messageId]);
    return result.rows[0] || null;
  }

  async getActiveProgress() {
    const result = await this.dbManager.query(`
      SELECT progress.* FROM onboarding_progress AS progress
      JOIN onboarding_configs AS config ON config.guild_id=progress.guild_id
      WHERE config.enabled=true AND config.category_id IS NOT NULL
        AND progress.departed_at IS NULL
        AND (progress.stage <> 'approved' OR progress.channel_id IS NOT NULL
             OR progress.review_action IS NOT NULL)`);
    return result.rows;
  }

  async getDueCleanup() {
    const result = await this.dbManager.query(`
      SELECT progress.* FROM onboarding_progress AS progress
      JOIN onboarding_configs AS config ON config.guild_id=progress.guild_id
      WHERE config.enabled=true AND config.category_id IS NOT NULL
        AND progress.departed_at IS NULL
        AND progress.stage='approved' AND progress.channel_id IS NOT NULL
        AND progress.review_action IS NULL
        AND progress.cleanup_at <= CURRENT_TIMESTAMP`);
    return result.rows;
  }

  async getInterruptedProgress() {
    const result = await this.dbManager.query(`
      SELECT progress.* FROM onboarding_progress AS progress
      JOIN onboarding_configs AS config ON config.guild_id=progress.guild_id
      WHERE config.enabled=true AND config.category_id IS NOT NULL
        AND progress.departed_at IS NULL
        AND (progress.review_action IS NOT NULL
             OR (progress.stage <> 'approved' AND (progress.message_id IS NULL OR progress.channel_id IS NULL))
             OR (progress.stage='pending' AND progress.review_message_id IS NULL))`);
    return result.rows;
  }

  async withMemberLock(guildId, userId, callback) {
    const connection = await this.dbManager.pool.connect();
    let locked = false;
    let destroyConnection = false;
    try {
      await connection.query('SELECT pg_advisory_lock(hashtext($1),hashtext($2))', [guildId, userId]);
      locked = true;
      return await callback(new OnboardingRepository(connection));
    } catch (error) {
      if (!locked) destroyConnection = true;
      throw error;
    } finally {
      try {
        if (locked) {
          const result = await connection.query('SELECT pg_advisory_unlock(hashtext($1),hashtext($2))', [guildId, userId]);
          if (result.rows[0]?.pg_advisory_unlock === false) throw new Error('Onboarding advisory lock was not held');
        }
      } catch (error) {
        destroyConnection = true;
        throw error;
      } finally {
        // A connection whose unlock failed must not return to the pool with a session lock held.
        connection.release(destroyConnection ? true : undefined);
      }
    }
  }

  async getProgress(guildId, userId) {
    const result = await this.dbManager.query(
      'SELECT * FROM onboarding_progress WHERE guild_id=$1 AND user_id=$2', [guildId, userId]
    );
    return result.rows[0] || null;
  }
}
