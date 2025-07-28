// scripts/registerCommands.ts - 슬래시 명령어 등록 스크립트
import { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import { SlashCommandBuilder } from '@discordjs/builders';
import { config } from '../src/config/env';

// 명령어 정의 배열 생성
const commands: SlashCommandBuilder[] = [];

// 잠수 명령어 (기존 gap_afk)
commands.push(
  new SlashCommandBuilder()
    .setName('잠수')
    .setDescription('사용자를 잠수 상태로 설정합니다.')
    .addUserOption(option =>
      option.setName('user')
            .setDescription('잠수 상태로 설정할 사용자')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('until_date')
            .setDescription('잠수 해제 날짜 (YYMMDD 형식, 예: 250510)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
            .setDescription('잠수 설정 사유 (선택사항)')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('notify_user')
            .setDescription('사용자에게 DM으로 알림 전송 여부')
            .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('duration_weeks')
            .setDescription('잠수 기간 (주 단위, 선택사항)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(52)
    )
);

// 설정 명령어 (기존 gap_config)
commands.push(
  new SlashCommandBuilder()
    .setName('설정')
    .setDescription('역할별 최소 활동시간 설정 관리 인터페이스를 표시합니다.')
);

// 보고서 명령어 (기존 gap_report)
commands.push(
  new SlashCommandBuilder()
    .setName('보고서')
    .setDescription('전체 길드 멤버의 활동 보고서를 생성합니다.')
    .addStringOption(option =>
      option.setName('start_date')
            .setDescription('시작 날짜 (YYMMDD 형식, 예: 241201)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('end_date')
            .setDescription('종료 날짜 (YYMMDD 형식, 예: 241231)')
            .setRequired(true)
    )
    .addBooleanOption(option =>
      option.setName('test_mode')
            .setDescription('테스트 모드 (리셋 시간 기록 안함)')
            .setRequired(false)
    )
);

// 시간체크 명령어
commands.push(
  new SlashCommandBuilder()
    .setName('시간체크')
    .setDescription('본인의 활동 시간을 조회합니다.')
    .addStringOption(option =>
      option.setName('start_date')
            .setDescription('시작 날짜 (YYMMDD 형식, 예: 241201)')
            .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('end_date')
            .setDescription('종료 날짜 (YYMMDD 형식, 예: 241231, 비워두면 현재 날짜)')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('detailed')
            .setDescription('상세 정보 표시 여부')
            .setRequired(false)
    )
    .addBooleanOption(option =>
      option.setName('public')
            .setDescription('공개 응답 여부 (기본값: 비공개)')
            .setRequired(false)
    )
);

// 구직 명령어 (그대로 유지)
commands.push(
  new SlashCommandBuilder()
    .setName('구직')
    .setDescription('구인구직 포럼 포스트를 생성합니다.')
);

// REST 클라이언트 생성
const rest = new REST({ version: '10' }).setToken(config.TOKEN);

// 길드 ID 확인 (명령줄 인수 또는 환경변수에서)
const guildId = process.argv[2] || process.env.REGISTER_GUILD_ID || process.env.GUILDID;
if (!guildId) {
  console.error('❌ 길드 ID가 필요합니다.');
  console.error('사용법: npm run register <GUILD_ID>');
  console.error('또는 REGISTER_GUILD_ID 또는 GUILDID 환경변수를 설정하세요.');
  process.exit(1);
}

(async (): Promise<void> => {
    try {
        console.log(`슬래시 명령어 등록을 시작합니다... (Guild ID: ${guildId})`);

        await rest.put(
          Routes.applicationGuildCommands(
            config.CLIENT_ID,
            guildId
          ),
          { body: commands.map(command => command.toJSON()) }
        );

        console.log('\n✅ 슬래시 명령어가 성공적으로 등록되었습니다!');
        console.log('\n📋 등록된 명령어 목록:');
        commands.forEach((command, index) => {
            const commandData = command.toJSON();
            console.log(`   ${index + 1}. /${commandData.name} - ${commandData.description}`);
        });
        console.log(`\n총 ${commands.length}개의 명령어가 등록되었습니다.\n`);
    } catch (error) {
        console.error('명령어 등록 중 오류 발생:', error);
    }
})();