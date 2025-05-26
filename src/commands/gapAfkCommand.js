// src/commands/gapAfkCommand.js - gap_afk 명령어
import {MessageFlags} from 'discord.js';
import {parseYYMMDD, calculateNextSunday, formatKoreanDateString} from '../utils/dateUtils.js';
import {CommandBase} from './CommandBase.js';

export class GapAfkCommand extends CommandBase {
  constructor(client, dbManager) {
    super({client, dbManager});
  }

  /**
   * gap_afk 명령어의 실제 실행 로직
   * @param interaction - 상호작용 객체
   */
  async executeCommand(interaction) {
    // 사용자 옵션 가져오기
    const targetUser = interaction.options.getUser("user");
    // 날짜 옵션 가져오기 (YYMMDD 형식)
    const dateStr = interaction.options.getString("until_date");

    if (!targetUser) {
      return await interaction.followUp({
        content: "사용자를 지정해주세요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!dateStr || !/^\d{6}$/.test(dateStr)) {
      return await interaction.followUp({
        content: "날짜는 YYMMDD 형식으로 입력해주세요. (예: 250510)",
        flags: MessageFlags.Ephemeral,
      });
    }

    // YYMMDD 형식 파싱
    const inputDate = parseYYMMDD(dateStr);

    // 지정된 날짜의 다음 일요일 계산
    const untilDate = calculateNextSunday(inputDate);

    // 현재 날짜보다 과거인지 확인
    const now = new Date();
    if (untilDate < now) {
      return await interaction.followUp({
        content: "지정한 날짜가 현재보다 과거입니다. 미래 날짜를 입력해주세요.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // 길드와 멤버 가져오기
    const guild = interaction.guild;
    const member = await guild.members.fetch(targetUser.id);

    if (!member) {
      return await interaction.followUp({
        content: "해당 사용자를 서버에서 찾을 수 없습니다.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // 잠수 역할 찾기 또는 생성
    let afkRole = guild.roles.cache.find(role => role.name === "잠수");
    if (!afkRole) {
      // 역할이 없으면 생성
      try {
        afkRole = await guild.roles.create({
          name: "잠수",
          reason: "잠수 상태 관리를 위한 역할"
        });
      } catch (error) {
        console.error("잠수 역할 생성 오류:", error);
        return await interaction.followUp({
          content: "잠수 역할을 생성할 수 없습니다. 권한을 확인해주세요.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    // 역할 부여
    await member.roles.add(afkRole);

    // DB에 잠수 정보 저장
    const saveResult = await this.dbManager.setUserAfkStatus(targetUser.id, member.displayName, untilDate.getTime());

    // 저장 확인 (디버깅용)
    if (saveResult) {
      const savedStatus = await this.dbManager.getUserAfkStatus(targetUser.id);
      console.log(`[디버깅] 잠수 상태 저장 확인:`, savedStatus);
    }

    // 한국어 날짜 포맷
    const formattedDate = formatKoreanDateString(untilDate);

    await interaction.followUp({
      content: `${targetUser.username}님을 ${formattedDate}까지 잠수 상태로 설정했습니다.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}