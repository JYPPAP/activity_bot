// src/commands/TeamCommand.js - 팀짜기 명령어
import { logger } from '../config/logger-termux.js';
import { DiscordConstants } from '../config/DiscordConstants.js';
import { config } from '../config/env.js';

export class TeamCommand {
  constructor(client) {
    this.client = client;
  }

  // ──────────────────────────────────────────────────────────────
  // 이전 팀 페어 이력 (길드 ID → { pairs: Set<string>, timestamp: number })
  // 마지막 팀짜기로부터 HISTORY_TTL_MS 이내에만 유효. 만료 시 무시.
  // ──────────────────────────────────────────────────────────────
  static lastPairHistory = new Map(); // guildId → { pairs: Set<string>, timestamp: number }
  static HISTORY_TTL_MS = 60 * 60 * 1000; // 1시간

  /**
   * 두 플레이어 이름으로 방향성 없는 페어 키 생성
   * @param {string} a
   * @param {string} b
   * @returns {string}
   */
  static makePairKey(a, b) {
    return a < b ? `${a}|||${b}` : `${b}|||${a}`;
  }

  /**
   * 팀 배치에서 같은 팀 내 모든 페어 집합 추출
   * @param {string[][]} teams
   * @returns {Set<string>}
   */
  static extractPairs(teams) {
    const pairs = new Set();
    for (const team of teams) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          pairs.add(TeamCommand.makePairKey(team[i], team[j]));
        }
      }
    }
    return pairs;
  }

  /**
   * 이전 이력과 비교해 같은 팀에 배치된 이전 페어 수 반환 (낮을수록 좋음)
   * @param {string[][]} teams
   * @param {Set<string>} history
   * @returns {number}
   */
  static scoreTeams(teams, history) {
    if (history.size === 0) return 0;
    let overlap = 0;
    for (const team of teams) {
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          if (history.has(TeamCommand.makePairKey(team[i], team[j]))) overlap++;
        }
      }
    }
    return overlap;
  }

  /**
   * Fisher-Yates 인플레이스 셔플
   * @param {any[]} arr
   */
  static shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  /**
   * 배열을 라운드로빈으로 팀 수만큼 나눔
   * @param {string[]} assignees
   * @param {number} teamCount
   * @returns {string[][]}
   */
  static distribute(assignees, teamCount) {
    const teams = Array.from({ length: teamCount }, () => []);
    for (let i = 0; i < assignees.length; i++) {
      teams[i % teamCount].push(assignees[i]);
    }
    return teams;
  }

  /**
   * 팀짜기 명령어를 실행합니다.
   * @param interaction - 상호작용 객체
   */
  async execute(interaction) {
    // 음성 채널 확인
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      await interaction.reply({
        content: '❌ 음성 채널에 접속한 상태에서 사용해주세요.',
        ephemeral: true,
      });
      return;
    }

    const totalCount = interaction.options.getInteger('전체인원');
    const teamCount = interaction.options.getInteger('팀수');

    if (teamCount > totalCount) {
      await interaction.reply({
        content: '❌ 팀 수가 전체 인원보다 많을 수 없습니다.',
        ephemeral: true,
      });
      return;
    }

    // 음성 채널 멤버 분류: 봇 제외 후 [관전], [대기], 활성 플레이어로 나눔
    const { SPECTATING, WAITING } = DiscordConstants.SPECIAL_TAGS;
    const allMembers = voiceChannel.members.filter(member => !member.user.bot);

    const activePlayers = allMembers
      .filter(member => !member.displayName.startsWith(SPECTATING) && !member.displayName.startsWith(WAITING))
      .map(member => `\`${member.displayName}\``);

    const waitingPlayers = allMembers
      .filter(member => member.displayName.startsWith(WAITING))
      .map(member => `\`${member.displayName}\``);

    // 우선순위 기반 풀 구성 (셔플은 아래 후보 생성 루프에서 처리)
    let basePool;
    let extraActives = [];
    let unusedWaiting = [];

    // active/waiting 각각 먼저 한 번만 셔플해 기준 순서를 만들어 둠
    TeamCommand.shuffle(activePlayers);
    TeamCommand.shuffle(waitingPlayers);

    if (activePlayers.length >= totalCount) {
      basePool = activePlayers.slice(0, totalCount);
      extraActives = activePlayers.slice(totalCount);
      unusedWaiting = [...waitingPlayers];
    } else if (activePlayers.length + waitingPlayers.length >= totalCount) {
      const needed = totalCount - activePlayers.length;
      basePool = [...activePlayers, ...waitingPlayers.slice(0, needed)];
      unusedWaiting = waitingPlayers.slice(needed);
    } else {
      basePool = [...activePlayers, ...waitingPlayers];
      for (let i = basePool.length + 1; i <= totalCount; i++) {
        basePool.push(`\`${i}번\``);
      }
    }

    const assignees = basePool.slice(0, totalCount);

    // ──────────────────────────────────────────────────────────────
    // 이전 팀 이력을 기반으로 가장 팀 구성이 달라지는 배치를 선택
    // CANDIDATE_COUNT번 셔플 후 이전 페어 중복이 가장 적은 배치 채택
    // ──────────────────────────────────────────────────────────────
    const guildId = interaction.guildId;
    const historyEntry = TeamCommand.lastPairHistory.get(guildId);
    const isHistoryValid = historyEntry &&
      (Date.now() - historyEntry.timestamp < TeamCommand.HISTORY_TTL_MS);
    const history = isHistoryValid ? historyEntry.pairs : new Set();

    if (historyEntry && !isHistoryValid) {
      logger.info('팀짜기 페어 이력 만료 — 이력 초기화', { component: 'TeamCommand', guildId });
      TeamCommand.lastPairHistory.delete(guildId);
    }

    const CANDIDATE_COUNT = 40; // 시도 횟수 (많을수록 다양성↑, 처리 시간↑)
    let bestTeams = null;
    let bestScore = Infinity;

    for (let attempt = 0; attempt < CANDIDATE_COUNT; attempt++) {
      const shuffled = [...assignees];
      TeamCommand.shuffle(shuffled);
      const candidate = TeamCommand.distribute(shuffled, teamCount);
      const score = TeamCommand.scoreTeams(candidate, history);

      if (score < bestScore) {
        bestScore = score;
        bestTeams = candidate;
        // 이전 팀과 완전히 다른 배치를 찾으면 즉시 종료
        if (bestScore === 0) break;
      }
    }

    const teams = bestTeams;

    // 선택된 팀 배치의 페어를 다음 팀짜기를 위해 저장 (타임스탬프 포함)
    TeamCommand.lastPairHistory.set(guildId, {
      pairs: TeamCommand.extractPairs(teams),
      timestamp: Date.now(),
    });

    logger.info('팀짜기 페어 히스토리 업데이트', {
      component: 'TeamCommand',
      guildId,
      overlapScore: bestScore,
      historyPairCount: TeamCommand.lastPairHistory.get(guildId).pairs.size,
      historyExpiresAt: new Date(Date.now() + TeamCommand.HISTORY_TTL_MS).toISOString(),
    });

    // 결과 포맷팅
    const teamChannelIds = config.TEAM_CHANNEL_IDS ?? [];
    const overlapNote = history.size > 0 && bestScore > 0
      ? `\n-# ⚠️ 이전 팀과 ${bestScore}쌍 겹침 (인원이 적어 완전 분리 불가)`
      : '';

    const lines = ['# 🎮 팀 구성 결과'];
    for (let i = 0; i < teams.length; i++) {
      const channelId = teamChannelIds[i];
      const channelSuffix = channelId ? ` <#${channelId}>` : '';
      lines.push(`## ${i + 1}팀${channelSuffix}`);
      lines.push(`## ${teams[i].join(' ')}`);
    }

    // 초과/대기 인원 하단 표시
    if (extraActives.length > 0) {
      lines.push('');
      lines.push(`-# 대기열: ${extraActives.join(' ')}`);
    }
    if (unusedWaiting.length > 0) {
      lines.push('');
      lines.push(`-# [대기]: ${unusedWaiting.join(' ')}`);
    }

    // 이전 팀과 겹침 경고 (완전 분리 불가한 경우)
    if (overlapNote) lines.push(overlapNote);

    const content = lines.join('\n');

    // Discord 메시지 길이 제한 (2000자) 초과 시 사용자에게 알림
    if (content.length > 2000) {
      await interaction.reply({
        content: `❌ 팀 구성 결과가 너무 길어 표시할 수 없습니다. (${content.length}자)\n팀 수나 전체 인원을 줄여주세요.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content });

    logger.info('팀짜기 명령어 실행', {
      component: 'TeamCommand',
      userId: interaction.user.id,
      totalCount,
      teamCount,
      activeCount: activePlayers.length,
      waitingCount: waitingPlayers.length,
      extraActiveCount: extraActives.length,
      unusedWaitingCount: unusedWaiting.length,
      channel: voiceChannel.name,
      overlapScore: bestScore,
    });
  }
}
