const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, PermissionsBitField, MessageFlags } = require("discord.js");
require('dotenv').config();
const keepAlive = require("./server");

const activityFilePath = path.join(__dirname, 'activity_info.json');
const configFilePath = path.join(__dirname, 'role_activity_config.json');
const excludedChannelIds = [
    process.env.EXCLUDE_CHANNELID_1,
    process.env.EXCLUDE_CHANNELID_2,
    process.env.EXCLUDE_CHANNELID_3,
    process.env.EXCLUDE_CHANNELID_4,
    process.env.EXCLUDE_CHANNELID_5
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let roleActivityConfig = {};
let channelActivityTime = {};

function loadJSON(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
            console.error("Error parsing JSON data:", error);
        }
    }
    return {};
}

function saveJSON(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Error saving JSON data:", error);
    }
}

function loadActivityData() {
    channelActivityTime = loadJSON(activityFilePath);
}

function loadRoleActivityConfig() {
    roleActivityConfig = loadJSON(configFilePath);
}

async function saveActivityData() {
    const now = Date.now();

    // Load existing activity data from JSON
    const existingActivityData = loadJSON(activityFilePath);

    // Update totalTime for each user based on their startTime
    for (const userId in channelActivityTime) {
        const userActivity = channelActivityTime[userId];
        if (userActivity.startTime) {
            const existingTotalTime = existingActivityData[userId]?.totalTime || 0;
            userActivity.totalTime = existingTotalTime + (now - userActivity.startTime);
            userActivity.startTime = now; // Reset startTime to now
        }
    }

    // Save the updated activity data including startTime
    saveJSON(activityFilePath, channelActivityTime);
}

async function clearAndReinitializeActivityData() {
    await saveActivityData(); // Ensure data is saved before clearing

    const now = Date.now();
    const guild = client.guilds.cache.get(process.env.GUILDID);

    channelActivityTime = {};
    guild.members.fetch().then(members => {
        members.forEach(member => {
            const voiceState = member.voice;
            if (voiceState && voiceState.channelId && !excludedChannelIds.includes(voiceState.channelId)) {
                channelActivityTime[member.id] = { startTime: now, totalTime: 0 };
            }
        });
    }).catch(error => {
        console.error("Error fetching guild members:", error);
    });
}

function splitContentByLines(content, maxLines) {
    const lines = content.split('\n');
    const chunks = [];
    for (let i = 0; i < lines.length; i += maxLines) {
        chunks.push(lines.slice(i, i + maxLines).join('\n'));
    }
    return chunks;
}

function formatTime(totalTime) {
    const hours = Math.floor(totalTime / 1000 / 60 / 60);
    const minutes = Math.floor((totalTime / 1000 / 60) % 60);
    return `${hours}시간 ${minutes}분`;
}

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
    loadActivityData();
    loadRoleActivityConfig();

    setInterval(() => {
        saveActivityData();
        clearAndReinitializeActivityData();
    }, 30 * 60 * 1000);
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const userId = newState.id;
    const now = Date.now();
    const member = newState.member;

    if (member && (member.displayName.includes('[관전]') || member.displayName.includes('[대기]'))) return;

    if (newState.channelId && !excludedChannelIds.includes(newState.channelId)) {
        if (!channelActivityTime[userId]) {
            channelActivityTime[userId] = { startTime: now, totalTime: 0 };
        } else if (!channelActivityTime[userId].startTime) {
            channelActivityTime[userId].startTime = now;
        }
    } else if (oldState.channelId && !excludedChannelIds.includes(oldState.channelId)) {
        if (channelActivityTime[userId] && channelActivityTime[userId].startTime) {
            channelActivityTime[userId].totalTime += now - channelActivityTime[userId].startTime;
            channelActivityTime[userId].startTime = null;
        }
    }
    saveActivityData();
});

client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    const userId = newMember.id;
    const now = Date.now();

    if (newMember.displayName.includes('[관전]') || newMember.displayName.includes('[대기]')) {
        if (channelActivityTime[userId] && channelActivityTime[userId].startTime) {
            channelActivityTime[userId].totalTime += now - channelActivityTime[userId].startTime;
            channelActivityTime[userId].startTime = null;
        }
    } else {
        const voiceState = newMember.voice;
        if (voiceState && voiceState.channelId && !excludedChannelIds.includes(voiceState.channelId)) {
            if (!channelActivityTime[userId]) {
                channelActivityTime[userId] = { startTime: now, totalTime: 0 };
            } else if (!channelActivityTime[userId].startTime) {
                channelActivityTime[userId].startTime = now;
            }
            saveActivityData();
        }
    }
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) &&
        interaction.user.id !== '592666673627004939') {
        await interaction.reply({
            content: "이 명령어를 실행할 권한이 없습니다.(관리자용)",
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    try {
        if (commandName === "gap_list") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const role = interaction.options.getString("role").split(',').map(r => r.trim());
            const guild = interaction.guild;
            const members = await guild.members.fetch();
            const roleMembers = members.filter(member => member.roles.cache.some(r => role.includes(r.name)));

            saveActivityData();
            const activityData = loadJSON(activityFilePath);
            const roleActivityConfig = loadJSON(configFilePath);
            const minActivityTime = roleActivityConfig[role] ? roleActivityConfig[role] * 60 * 60 * 1000 : 0;

            const activeUsers = [];
            const inactiveUsers = [];

            roleMembers.forEach(member => {
                const userId = member.user.id;
                const activity = activityData[userId] || { totalTime: 0 };
                const userData = {
                    userId: userId,
                    nickname: member.displayName,
                    totalTime: activity.totalTime
                };

                if (userData.totalTime >= minActivityTime) {
                    activeUsers.push(userData);
                } else {
                    inactiveUsers.push(userData);
                }
            });

            activeUsers.sort((a, b) => b.totalTime - a.totalTime);
            inactiveUsers.sort((a, b) => b.totalTime - a.totalTime);

            const formatData = (data) => data.map(user => ({
                '이름': user.nickname,
                '활동 시간': `${Math.floor(user.totalTime / 1000 / 60 / 60)}시간 ${Math.floor((user.totalTime / 1000 / 60) % 60)}분`
            }));

            const formattedActiveData = formatData(activeUsers);
            const formattedInactiveData = formatData(inactiveUsers);

            const maxNameLength = Math.max(...formattedActiveData.map(data => data['이름'].length), ...formattedInactiveData.map(data => data['이름'].length), 5);
            const maxTimeLength = Math.max(...formattedActiveData.map(data => data['활동 시간'].length), ...formattedInactiveData.map(data => data['활동 시간'].length), 5);

            const formattedActiveString = formattedActiveData.map(data =>
                `이름: ${data['이름'].padEnd(maxNameLength)}  활동 시간: ${data['활동 시간'].padEnd(maxTimeLength)}`
            ).join('\n');

            const formattedInactiveString = formattedInactiveData.map(data =>
                `이름: ${data['이름'].padEnd(maxNameLength)}  활동 시간: ${data['활동 시간'].padEnd(maxTimeLength)}`
            ).join('\n');

            const activeChunks = splitContentByLines(`활동 시간 데이터:\n\n**활동 사용자:**\n${formattedActiveString}`, 30);
            const inactiveChunks = splitContentByLines(`\n\n**잠수 사용자:**\n${formattedInactiveString}`, 30);

            for (const chunk of activeChunks) {
                await interaction.followUp({
                    content: chunk,
                    flags: MessageFlags.Ephemeral,
                });
            }

            for (const chunk of inactiveChunks) {
                await interaction.followUp({
                    content: chunk,
                    flags: MessageFlags.Ephemeral,
                });
            }

            // saveActivityData();
        // } else if (commandName === "is_bot_alive") {
        //     await interaction.reply({
        //         content: "봇이 살아있습니다!",
        //         flags: MessageFlags.Ephemeral,
        //     });
        } else if (commandName === "gap_config") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const role = interaction.options.getString("role").replace(/@/g, '');
            const hours = interaction.options.getInteger("hours");
            roleActivityConfig[role] = hours;

            saveJSON(configFilePath, roleActivityConfig);

            await interaction.followUp({
                content: `역할 ${role} 의 최소 활동시간을 ${hours} 시간으로 설정 했습니다!`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (commandName === "gap_reset") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const role = interaction.options.getString("role").replace(/@/g, '');
            const members = interaction.guild.members.cache.filter(member => member.roles.cache.some(r => r.name === role));

            members.forEach(member => {
                if (channelActivityTime[member.user.id]) {
                    delete channelActivityTime[member.user.id];
                }
            });

            saveActivityData();

            await interaction.followUp({
                content: `역할 ${role} 의 모든 사용자의 활동 시간이 초기화되었습니다.`,
                flags: MessageFlags.Ephemeral,
            });
        } else if (commandName === "gap_check") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const user = interaction.options.getUser("user");
            const userId = user.id;

            saveActivityData();
            const activityData = loadJSON(activityFilePath);
            const activity = activityData[userId] || { totalTime: 0 };

            console.log('Activity Data:');
            console.table(Object.entries(activityData).map(([id, data]) => ({
                userId: id,
                startTime: data.startTime,
                totalTime: formatTime(data.totalTime)
            })));
            console.log('User Activity:');
            console.table({
                userId: userId,
                startTime: activity.startTime,
                totalTime: formatTime(activity.totalTime)
            });

            const totalTime = activity.totalTime;
            const hours = Math.floor(totalTime / 1000 / 60 / 60);
            const minutes = Math.floor((totalTime / 1000 / 60) % 60);

            await interaction.followUp({
                content: `${user.username}님의 총 활동 시간은 ${hours}시간 ${minutes}분 입니다.`,
                flags: MessageFlags.Ephemeral,
            });

            // saveActivityData();
        } else if (commandName === "gap_save") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            await saveActivityData();
            clearAndReinitializeActivityData();

            await interaction.followUp({
                content: "활동 데이터가 저장되고 초기화되었습니다.",
                flags: MessageFlags.Ephemeral,
            });
        }
    } catch (error) {
        console.error("Error handling interaction:", error);
        await interaction.reply({
            content: "요청 수행 중 에러 발생!",
            flags: MessageFlags.Ephemeral,
        });
    }
});

keepAlive();
client.login(process.env.TOKEN);
