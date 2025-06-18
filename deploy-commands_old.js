const { REST, Routes } = require("discord.js");
require('dotenv').config();

const commands = [
    {
        name: "gap_list",
        description: "역할별 활동 시간 출력",
        options: [
            {
                name: 'role',
                type: 3, // STRING type
                description: '역할 필터 (쉼표로 구분된 역할 목록)',
                required: true,
            },
        ],
    },
    {
        name: "gap_config",
        description: "역할별 최소 활동 시간 설정",
        options: [
            {
                name: "role",
                type: 3, // STRING type
                description: "최소 활동 시간을 지정할 역할의 이름",
                required: true,
            },
            {
                name: "hours",
                type: 4, // INTEGER type
                description: "최소 활동 시간",
                required: true,
            },
        ],
    },
    {
        name: "gap_reset",
        description: "역할별 활동 시간 초기화",
        options: [
            {
                name: "role",
                type: 3, // STRING type
                description: "활동 시간을 초기화할 역할의 이름",
                required: true,
            },
        ],
    },
    {
        name: "gap_check",
        description: "특정 사용자의 활동 시간 체크",
        options: [
            {
                name: "user",
                type: 6, // USER type
                description: "활동 시간을 체크할 사용자",
                required: true,
            },
        ],
    },
    {
        name: "gap_save",
        description: "활동 데이터를 최신화(봇 리셋 시 사용)",
    },
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log("Started refreshing application (/) commands.");

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENTID,
                process.env.GUILDID,
            ),
            { body: commands },
        );

        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error(error);
    }
})();
