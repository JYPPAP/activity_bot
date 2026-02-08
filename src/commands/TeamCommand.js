// src/commands/TeamCommand.js - 팀짜기 명령어
import { logger } from '../config/logger-termux.js';
import { DiscordConstants } from '../config/DiscordConstants.js';

export class TeamCommand {
  constructor(client) {
    this.client = client;
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

    // Fisher-Yates 셔플 (각 그룹 독립 셔플)
    for (const arr of [activePlayers, waitingPlayers]) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }

    // 우선순위 기반 풀 구성
    let pool;
    let extraActives = [];
    let unusedWaiting = [];

    if (activePlayers.length >= totalCount) {
      // active만으로 충분 — 초과 active + 전체 [대기]는 대기열로
      pool = activePlayers.slice(0, totalCount);
      extraActives = activePlayers.slice(totalCount);
      unusedWaiting = [...waitingPlayers];
    } else if (activePlayers.length + waitingPlayers.length >= totalCount) {
      // active 전원 + [대기]로 부족분 충원
      const needed = totalCount - activePlayers.length;
      pool = [...activePlayers, ...waitingPlayers.slice(0, needed)];
      unusedWaiting = waitingPlayers.slice(needed);
    } else {
      // 전원 투입 + 나머지 N번으로 채움
      pool = [...activePlayers, ...waitingPlayers];
      for (let i = pool.length + 1; i <= totalCount; i++) {
        pool.push(`\`${i}번\``);
      }
    }

    // 전체인원만큼만 사용
    const assignees = pool.slice(0, totalCount);

    // 라운드로빈 분배
    const teams = Array.from({ length: teamCount }, () => []);
    for (let i = 0; i < assignees.length; i++) {
      teams[i % teamCount].push(assignees[i]);
    }

    // 결과 포맷팅
    const lines = ['🎮 **팀 구성 결과**'];
    for (let i = 0; i < teams.length; i++) {
      lines.push(`**${i + 1}팀**`);
      lines.push(teams[i].join(' '));
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

    await interaction.reply({ content: lines.join('\n') });

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
    });
  }
}
