// src/commands/TeamCommand.js - 팀짜기 명령어
import { logger } from '../config/logger-termux.js';

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

    // 음성 채널 멤버에서 봇 제외, [관전] prefix 제외
    const participants = voiceChannel.members
      .filter(member => !member.user.bot)
      .filter(member => !member.displayName.startsWith('[관전]'))
      .map(member => `\`${member.displayName}\``);

    // Fisher-Yates 셔플
    for (let i = participants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [participants[i], participants[j]] = [participants[j], participants[i]];
    }

    // 전체인원이 참가자보다 크면 부족분을 N번으로 채움
    const pool = [...participants];
    if (totalCount > pool.length) {
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

    await interaction.reply({ content: lines.join('\n') });

    logger.info('팀짜기 명령어 실행', {
      component: 'TeamCommand',
      userId: interaction.user.id,
      totalCount,
      teamCount,
      participantCount: participants.length,
      channel: voiceChannel.name,
    });
  }
}
