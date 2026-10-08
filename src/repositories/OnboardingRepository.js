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
        guild_id, welcome_channel_id, game_channel_id, rules_channel_id,
        application_channel_id, review_channel_id, gender_male_role_id,
        gender_female_role_id, stage_role_ids, pending_role_id, member_role_id, enabled
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,true)
      ON CONFLICT (guild_id) DO UPDATE SET
        welcome_channel_id=EXCLUDED.welcome_channel_id, game_channel_id=EXCLUDED.game_channel_id,
        rules_channel_id=EXCLUDED.rules_channel_id, application_channel_id=EXCLUDED.application_channel_id,
        review_channel_id=EXCLUDED.review_channel_id, gender_male_role_id=EXCLUDED.gender_male_role_id,
        gender_female_role_id=EXCLUDED.gender_female_role_id, stage_role_ids=EXCLUDED.stage_role_ids,
        pending_role_id=EXCLUDED.pending_role_id, member_role_id=EXCLUDED.member_role_id,
        enabled=true, updated_at=CURRENT_TIMESTAMP
      RETURNING *`, [guildId, config.welcomeChannelId, config.gameChannelId,
      config.rulesChannelId, config.applicationChannelId, config.reviewChannelId,
      config.maleRoleId, config.femaleRoleId, JSON.stringify(config.stageRoleIds),
      config.pendingRoleId, config.memberRoleId]);
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
      RETURNING game_roles`, [guildId, label, roleId]);

    if (!result.rows[0]) {
      throw new Error('먼저 가입 관리 설정을 완료해 주세요.');
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

  async setStage(guildId, userId, stage, fields = {}) {
    const result = await this.dbManager.query(`
      UPDATE onboarding_progress SET stage=$3, gender_role_id=COALESCE($4,gender_role_id),
        game_role_ids=COALESCE($5::jsonb,game_role_ids),
        rules_accepted_at=CASE WHEN $6 THEN COALESCE(rules_accepted_at, CURRENT_TIMESTAMP) ELSE rules_accepted_at END,
        applied_at=CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE applied_at END,
        reviewed_at=CASE WHEN $8 IS NOT NULL THEN CURRENT_TIMESTAMP ELSE reviewed_at END,
        reviewed_by=COALESCE($8,reviewed_by), rejection_reason=$9, updated_at=CURRENT_TIMESTAMP
      WHERE guild_id=$1 AND user_id=$2 RETURNING *`,
    [guildId, userId, stage, fields.genderRoleId || null,
      fields.gameRoleIds ? JSON.stringify(fields.gameRoleIds) : null,
      Boolean(fields.rulesAccepted), Boolean(fields.applied), fields.reviewedBy || null,
      fields.rejectionReason || null]);
    return result.rows[0];
  }

  async getProgress(guildId, userId) {
    const result = await this.dbManager.query(
      'SELECT * FROM onboarding_progress WHERE guild_id=$1 AND user_id=$2', [guildId, userId]
    );
    return result.rows[0] || null;
  }
}
