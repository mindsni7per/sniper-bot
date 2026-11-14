import { PermissionFlagsBits } from 'discord.js';
import { registerCommand, hasStaffPerm } from '../registry.js';
import { getGuild, saveDB, getAllGuildIds } from '../db.js';
import { goldEmbed, silverEmbed, parseDuration, fmtDuration } from '../config.js';

export async function tickTempRolesAndGhostPings(client) {
  const now = Date.now();
  for (const gid of getAllGuildIds()) {
    const g = getGuild(gid);
    const guild = client.guilds.cache.get(gid);
    if (!guild) continue;

    // Expire temporary roles
    let changed = false;
    for (let i = g.temproles.length - 1; i >= 0; i--) {
      const tr = g.temproles[i];
      if (tr.expiresAt && tr.expiresAt <= now) {
        const mem = await guild.members.fetch(tr.userId).catch(() => null);
        if (mem) await mem.roles.remove(tr.roleId, 'Temporary role expired').catch(() => {});
        if (g.temproleLog) {
          const ch = guild.channels.cache.get(g.temproleLog);
          ch?.send({ embeds: [silverEmbed('⏳ Temp Role Expired', `<@${tr.userId}> lost <@&${tr.roleId}>.`)] }).catch(() => {});
        }
        g.temproles.splice(i, 1);
        changed = true;
      }
    }

    // Scheduled ghost pings
    for (const gp of g.ghostpings) {
      if (gp.nextRun <= now) {
        const ch = guild.channels.cache.get(gp.channelId);
        if (ch) {
          const sent = await ch.send({ content: `<@&${gp.roleId}> ${gp.message || ''}`.trim() }).catch(() => null);
          if (sent) setTimeout(() => sent.delete().catch(() => {}), (gp.deleteAfter || 3) * 1000);
        }
        gp.nextRun = now + gp.everyMs;
        changed = true;
      }
    }
    if (changed) saveDB();
  }
}

export function loadRoles1Module() {
  registerCommand({
    name: 'role',
    category: 'Roles & Members',
    description: 'Manage member roles',
    subcommands: [
      { name: 'add', description: 'Give a member a role', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'reason', type: 'string', description: 'Reason', required: false }] },
      { name: 'remove', description: 'Take a role away from a member', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'reason', type: 'string', description: 'Reason', required: false }] },
      { name: 'all', description: 'Give or take a role from many members', options: [{ name: 'action', type: 'string', description: 'add or remove', choices: ['add', 'remove'], required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'who', type: 'string', description: 'all, humans, bots', choices: ['all', 'humans', 'bots'], required: false }, { name: 'with_role', type: 'role', description: 'Only members with this role', required: false }] },
      { name: 'info', description: 'Show who has a role', default: true, options: [{ name: 'role', type: 'role', description: 'Role', required: true }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      const role = ctx.getRole('role');
      if (!role) return ctx.reply('Specify a valid role.');
      if (ctx.sub === 'info') {
        await ctx.guild.members.fetch().catch(() => {});
        const members = [...role.members.values()];
        const list = members.slice(0, 25).map((m) => `${m}`).join(', ') || 'No members';
        return ctx.reply({ embeds: [silverEmbed(`🎭 Role Info — ${role.name}`, `• ID: \`${role.id}\`\n• Color: \`${role.hexColor}\`\n• Members (${members.length}): ${list}`)] });
      }
      if (!hasStaffPerm(ctx.member, g) && !ctx.member.permissions.has(PermissionFlagsBits.ManageRoles)) return ctx.reply('Manage Roles permission required.');
      if (ctx.sub === 'all') {
        await ctx.defer();
        await ctx.guild.members.fetch().catch(() => {});
        const act = ctx.getString('action');
        const who = ctx.getString('who') || 'all';
        const filterRole = ctx.getRole('with_role');
        let count = 0;
        for (const m of ctx.guild.members.cache.values()) {
          if (who === 'humans' && m.user.bot) continue;
          if (who === 'bots' && !m.user.bot) continue;
          if (filterRole && !m.roles.cache.has(filterRole.id)) continue;
          if (act === 'add' && !m.roles.cache.has(role.id)) { await m.roles.add(role).catch(() => {}); count++; }
          if (act === 'remove' && m.roles.cache.has(role.id)) { await m.roles.remove(role).catch(() => {}); count++; }
        }
        return ctx.reply({ embeds: [goldEmbed('✅ Mass Role Complete', `${act === 'add' ? 'Added' : 'Removed'} ${role} for **${count}** members.`)] });
      }
      const user = ctx.getUser('user');
      const target = user && await ctx.guild.members.fetch(user.id).catch(() => null);
      if (!target) return ctx.reply('Member not found.');
      const reason = ctx.getString('reason') || `By ${ctx.user.tag}`;
      if (ctx.sub === 'add') { await target.roles.add(role, reason); return ctx.reply({ embeds: [goldEmbed('✅ Role Added', `Gave ${role} to ${target}.`)] }); }
      if (ctx.sub === 'remove') { await target.roles.remove(role, reason); return ctx.reply({ embeds: [silverEmbed('✅ Role Removed', `Removed ${role} from ${target}.`)] }); }
    },
  });

  registerCommand({
    name: 'temprole',
    category: 'Roles & Members',
    description: 'Temporary timed roles',
    subcommands: [
      { name: 'give', description: 'Give a role for a set time or lifetime', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'duration', type: 'string', description: 'Duration (e.g. 1h, 7d, lifetime)', required: false }, { name: 'reason', type: 'string', description: 'Reason', required: false }] },
      { name: 'remove', description: 'End a temporary role early', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }] },
      { name: 'extend', description: 'Extend a running temp role', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'duration', type: 'string', description: 'Extra duration or lifetime', required: true }] },
      { name: 'list', description: 'Show running temporary roles', default: true, options: [{ name: 'user', type: 'user', description: 'Filter by user', required: false }] },
      { name: 'setup', description: 'Set temp role log channel', options: [{ name: 'logchannel', type: 'channel', description: 'Log channel', required: true }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') {
        const u = ctx.getUser('user');
        const list = g.temproles.filter((t) => !u || t.userId === u.id);
        const desc = list.map((t) => `• <@${t.userId}> — <@&${t.roleId}> (${t.expiresAt ? `<t:${Math.floor(t.expiresAt / 1000)}:R>` : 'Lifetime'})`).join('\n') || 'No active temporary roles.';
        return ctx.reply({ embeds: [silverEmbed('⏳ Temporary Roles', desc)] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'setup') {
        const ch = ctx.getChannel('logchannel');
        g.temproleLog = ch?.id || null;
        saveDB();
        return ctx.reply(`Temp role logs set to ${ch}.`);
      }
      const user = ctx.getUser('user');
      const role = ctx.getRole('role');
      const mem = user && await ctx.guild.members.fetch(user.id).catch(() => null);
      if (!mem || !role) return ctx.reply('Provide a valid member and role.');
      if (ctx.sub === 'give') {
        const durMs = parseDuration(ctx.getString('duration') || 'lifetime');
        if (durMs === null) return ctx.reply('Invalid duration (use `1h`, `7d`, `lifetime`).');
        await mem.roles.add(role, ctx.getString('reason') || 'Temp role');
        g.temproles = g.temproles.filter((t) => !(t.userId === mem.id && t.roleId === role.id));
        g.temproles.push({ userId: mem.id, roleId: role.id, expiresAt: durMs === 0 ? null : Date.now() + durMs });
        saveDB();
        return ctx.reply({ embeds: [goldEmbed('⏳ Temp Role Given', `${mem} received ${role} (${durMs === 0 ? 'Lifetime' : fmtDuration(durMs)}).`)] });
      }
      if (ctx.sub === 'remove') {
        await mem.roles.remove(role).catch(() => {});
        g.temproles = g.temproles.filter((t) => !(t.userId === mem.id && t.roleId === role.id));
        saveDB();
        return ctx.reply(`Removed ${role} from ${mem}.`);
      }
      if (ctx.sub === 'extend') {
        const entry = g.temproles.find((t) => t.userId === mem.id && t.roleId === role.id);
        if (!entry) return ctx.reply('No active temp role found for that member/role.');
        const durMs = parseDuration(ctx.getString('duration'));
        if (durMs === null) return ctx.reply('Invalid duration.');
        entry.expiresAt = durMs === 0 ? null : (entry.expiresAt || Date.now()) + durMs;
        saveDB();
        return ctx.reply(`Extended ${role} for ${mem}.`);
      }
    },
  });

  registerCommand({
    name: 'invites',
    category: 'Roles & Members',
    description: 'Invite tracker and cross-check',
    subcommands: [
      { name: 'check', description: 'Invite count of a member', default: true, options: [{ name: 'user', type: 'user', description: 'Member', required: false }] },
      { name: 'info', description: 'Who invited a member', options: [{ name: 'user', type: 'user', description: 'Member', required: true }] },
      { name: 'list', description: 'Members a person invited', options: [{ name: 'user', type: 'user', description: 'Inviter', required: false }] },
      { name: 'top', description: 'Top inviters of the server' },
      { name: 'bonus', description: '(Staff) Add or remove bonus invites', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'amount', type: 'integer', description: 'Amount (+/-)', required: true }] },
      { name: 'reset', description: '(Staff) Reset a member invites', options: [{ name: 'user', type: 'user', description: 'Member', required: true }] },
      { name: 'resetall', description: '(Staff) Reset ALL invites', options: [{ name: 'confirm', type: 'string', description: 'Type CONFIRM', required: true }] },
      { name: 'setup', description: '(Staff) Join log channel & fake days', options: [{ name: 'logchannel', type: 'channel', description: 'Log channel', required: false }, { name: 'fakedays', type: 'integer', description: 'Min account age days', required: false }] },
      { name: 'crosscheck', description: '(Staff) Cross-check channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: false }, { name: 'off', type: 'boolean', description: 'Turn off?', required: false }] },
      { name: 'crosstest', description: '(Staff) Send sample cross-check message' },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'check') {
        const u = ctx.getUser('user') || ctx.user;
        const d = g.invites[u.id] || { regular: 0, left: 0, fake: 0, members: [] };
        const bonus = g.inviteBonus[u.id] || 0;
        const total = (d.regular || 0) + bonus - (d.left || 0);
        return ctx.reply({ embeds: [goldEmbed(`📨 Invites — ${u.username}`, `**Total:** ${total}\n• Regular: ${d.regular || 0}\n• Bonus: ${bonus}\n• Left: ${d.left || 0}\n• Fake: ${d.fake || 0}`)] });
      }
      if (ctx.sub === 'info') {
        const u = ctx.getUser('user');
        if (!u) return ctx.reply('Specify a user.');
        const rec = g.invitedBy[u.id];
        return ctx.reply({ embeds: [silverEmbed(`📨 Invite Info — ${u.username}`, rec ? `Invited by <@${rec.inviterId}> via \`${rec.code}\` (<t:${Math.floor(rec.at / 1000)}:R>)` : 'Unknown inviter (vanity/before bot joined).')] });
      }
      if (ctx.sub === 'list') {
        const u = ctx.getUser('user') || ctx.user;
        const list = g.invites[u.id]?.members || [];
        return ctx.reply({ embeds: [silverEmbed(`📨 Invited by ${u.username}`, list.slice(-20).map((m) => `• <@${m}>`).join('\n') || 'None tracked.')] });
      }
      if (ctx.sub === 'top') {
        const rows = Object.entries(g.invites).map(([id, d]) => [id, (d.regular || 0) + (g.inviteBonus[id] || 0) - (d.left || 0)]).sort((a, b) => b[1] - a[1]).slice(0, 10);
        return ctx.reply({ embeds: [goldEmbed('🏆 Top Inviters', rows.map(([id, n], i) => `**${i + 1}.** <@${id}> — **${n}**`).join('\n') || 'No invite data.')] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'bonus') {
        const u = ctx.getUser('user'); const amt = ctx.getInteger('amount');
        if (!u || amt === null) return ctx.reply('Specify user and amount.');
        g.inviteBonus[u.id] = (g.inviteBonus[u.id] || 0) + amt;
        saveDB();
        return ctx.reply(`Updated bonus invites for ${u} to **${g.inviteBonus[u.id]}**.`);
      }
      if (ctx.sub === 'reset') { const u = ctx.getUser('user'); if (u) { delete g.invites[u.id]; delete g.inviteBonus[u.id]; saveDB(); } return ctx.reply(`Reset invites for ${u}.`); }
      if (ctx.sub === 'resetall') { if ((ctx.getString('confirm') || '').toUpperCase() !== 'CONFIRM') return ctx.reply('Type `CONFIRM`.'); g.invites = {}; g.inviteBonus = {}; g.invitedBy = {}; saveDB(); return ctx.reply('Reset all invites.'); }
      if (ctx.sub === 'setup') {
        const ch = ctx.getChannel('logchannel'); const fd = ctx.getInteger('fakedays');
        if (ch) g.inviteConfig.logChannel = ch.id;
        if (fd !== null) g.inviteConfig.fakeDays = fd;
        saveDB();
        return ctx.reply('Invite setup saved.');
      }
      if (ctx.sub === 'crosscheck') {
        g.inviteConfig.crosscheckChannel = ctx.getBoolean('off') ? null : (ctx.getChannel('channel')?.id || ctx.channel.id);
        saveDB();
        return ctx.reply(g.inviteConfig.crosscheckChannel ? `Cross-check enabled in <#${g.inviteConfig.crosscheckChannel}>.` : 'Cross-check disabled.');
      }
      if (ctx.sub === 'crosstest') {
        return ctx.reply({ embeds: [goldEmbed('🔍 Cross-Check Sample', `${ctx.user} joined • Invited by ${ctx.user} (12 invites) • Account age: 365d`)] });
      }
    },
  });

  registerCommand({
    name: 'welcome',
    category: 'Roles & Members',
    description: 'Welcome and goodbye messages',
    subcommands: [
      { name: 'setup', description: 'Turn on welcome messages', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }, { name: 'message', type: 'string', description: 'Use {user} and {server}', required: false }, { name: 'role', type: 'role', description: 'Auto-role on join', required: false }, { name: 'ping', type: 'boolean', description: 'Ping user outside embed', required: false }] },
      { name: 'test', description: 'Preview welcome message' },
      { name: 'leavesetup', description: 'Set goodbye messages', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }, { name: 'message', type: 'string', description: 'Use {user} and {server}', required: false }] },
      { name: 'leavetest', description: 'Preview goodbye message' },
      { name: 'leaveoff', description: 'Turn goodbye messages off' },
      { name: 'off', description: 'Turn welcome messages off' },
      { name: 'status', description: 'Show current welcome settings', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'status') {
        return ctx.reply({ embeds: [silverEmbed('👋 Welcome Settings', `• Welcome Channel: ${g.welcome.channel ? `<#${g.welcome.channel}>` : 'Off'}\n• Auto-role: ${g.welcome.role ? `<@&${g.welcome.role}>` : 'None'}\n• Leave Channel: ${g.welcome.leaveChannel ? `<#${g.welcome.leaveChannel}>` : 'Off'}`)] });
      }
      if (ctx.sub === 'test') {
        const txt = (g.welcome.message || 'Welcome {user} to {server}!').replace(/\{user\}/g, `${ctx.user}`).replace(/\{server\}/g, ctx.guild.name);
        return ctx.reply({ embeds: [goldEmbed(`👋 Welcome to ${ctx.guild.name}`, txt).setThumbnail(ctx.user.displayAvatarURL())] });
      }
      if (ctx.sub === 'leavetest') {
        const txt = (g.welcome.leaveMessage || 'Goodbye {user}.').replace(/\{user\}/g, `${ctx.user.tag}`).replace(/\{server\}/g, ctx.guild.name);
        return ctx.reply({ embeds: [silverEmbed('👋 Member Left', txt)] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'setup') {
        g.welcome.channel = ctx.getChannel('channel')?.id || null;
        if (ctx.getString('message')) g.welcome.message = ctx.getString('message');
        if (ctx.getRole('role')) g.welcome.role = ctx.getRole('role').id;
        if (ctx.getBoolean('ping') !== null) g.welcome.ping = ctx.getBoolean('ping');
      }
      if (ctx.sub === 'leavesetup') {
        g.welcome.leaveChannel = ctx.getChannel('channel')?.id || null;
        if (ctx.getString('message')) g.welcome.leaveMessage = ctx.getString('message');
      }
      if (ctx.sub === 'off') g.welcome.channel = null;
      if (ctx.sub === 'leaveoff') g.welcome.leaveChannel = null;
      saveDB();
      return ctx.reply('Welcome settings updated.');
    },
  });

  registerCommand({
    name: 'joinping',
    category: 'Roles & Members',
    description: 'Auto-ping new members and welcome DMs',
    subcommands: [
      { name: 'add', description: 'Ping new members in a channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }, { name: 'message', type: 'string', description: 'Extra text', required: false }, { name: 'deleteafter', type: 'integer', description: 'Delete after seconds', required: false }] },
      { name: 'dm', description: 'Toggle welcome DMs', options: [{ name: 'enabled', type: 'boolean', description: 'On/Off', required: false }, { name: 'mode', type: 'string', description: 'random or all', choices: ['random', 'all'], required: false }] },
      { name: 'dmadd', description: 'Add a welcome DM message', options: [{ name: 'message', type: 'string', description: 'Message text', required: true }] },
      { name: 'dmremove', description: 'Remove welcome DM by number', options: [{ name: 'number', type: 'integer', description: 'Message #', required: true }] },
      { name: 'dmstatus', description: 'Show welcome DM settings' },
      { name: 'dmtest', description: 'DM yourself the welcome message' },
      { name: 'list', description: 'List join-ping channels', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') {
        return ctx.reply({ embeds: [silverEmbed('🔔 Join Ping Channels', g.joinping.channels.map((c) => `• <#${c.channelId}> (del ${c.deleteAfter}s)`).join('\n') || 'None configured.')] });
      }
      if (ctx.sub === 'dmstatus') {
        return ctx.reply({ embeds: [silverEmbed('📩 Welcome DM Status', `Enabled: **${g.joinping.dmEnabled}** | Mode: **${g.joinping.dmMode}**\n` + (g.joinping.dmMessages.map((m, i) => `**${i + 1}.** ${m}`).join('\n') || 'No DM messages.'))] });
      }
      if (ctx.sub === 'dmtest') {
        const msg = g.joinping.dmMessages[0] || `Welcome to ${ctx.guild.name}!`;
        await ctx.user.send(msg).catch(() => {});
        return ctx.reply('Sent test DM (check your DMs).');
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'add') {
        const ch = ctx.getChannel('channel');
        if (!ch) return ctx.reply('Specify channel.');
        g.joinping.channels = g.joinping.channels.filter((x) => x.channelId !== ch.id);
        g.joinping.channels.push({ channelId: ch.id, message: ctx.getString('message') || '', deleteAfter: ctx.getInteger('deleteafter') ?? 5 });
      }
      if (ctx.sub === 'dm') {
        if (ctx.getBoolean('enabled') !== null) g.joinping.dmEnabled = ctx.getBoolean('enabled');
        if (ctx.getString('mode')) g.joinping.dmMode = ctx.getString('mode');
      }
      if (ctx.sub === 'dmadd') g.joinping.dmMessages.push(ctx.getString('message'));
      if (ctx.sub === 'dmremove') g.joinping.dmMessages.splice((ctx.getInteger('number') || 1) - 1, 1);
      saveDB();
      return ctx.reply('Joinping settings updated.');
    },
  });

  registerCommand({
    name: 'ghostping',
    category: 'Roles & Members',
    description: 'Scheduled role ghost pings',
    subcommands: [
      { name: 'add', description: 'Schedule a recurring ghost ping', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'every', type: 'string', description: 'Interval (e.g. 24h)', required: false }, { name: 'message', type: 'string', description: 'Message', required: false }, { name: 'deleteafter', type: 'integer', description: 'Delete seconds', required: false }] },
      { name: 'remove', description: 'Remove a scheduled ghost ping by #', options: [{ name: 'number', type: 'integer', description: 'Index #', required: true }] },
      { name: 'list', description: 'Show all ghost pings', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') {
        const desc = g.ghostpings.map((gp, i) => `**#${i + 1}** <#${gp.channelId}> → <@&${gp.roleId}> every **${fmtDuration(gp.everyMs)}**`).join('\n') || 'None scheduled.';
        return ctx.reply({ embeds: [silverEmbed('👻 Ghost Pings', desc)] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'add') {
        const ch = ctx.getChannel('channel'); const role = ctx.getRole('role');
        const everyMs = parseDuration(ctx.getString('every') || '24h') || 86400000;
        if (!ch || !role) return ctx.reply('Specify channel and role.');
        g.ghostpings.push({ channelId: ch.id, roleId: role.id, everyMs, message: ctx.getString('message') || '', deleteAfter: ctx.getInteger('deleteafter') ?? 3, nextRun: Date.now() + 5000 });
        saveDB();
        return ctx.reply(`Scheduled ghost ping for ${role} in ${ch} every **${fmtDuration(everyMs)}**.`);
      }
      if (ctx.sub === 'remove') {
        g.ghostpings.splice((ctx.getInteger('number') || 1) - 1, 1);
        saveDB();
        return ctx.reply('Removed ghost ping.');
      }
    },
  });

  registerCommand({
    name: 'sticky',
    category: 'Roles & Members',
    description: 'Keep a sticky message pinned at the bottom of a channel',
    subcommands: [
      { name: 'set', description: 'Set sticky message', options: [{ name: 'text', type: 'string', description: 'Sticky content', required: true }, { name: 'channel', type: 'channel', description: 'Channel', required: false }] },
      { name: 'remove', description: 'Remove sticky message', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: false }] },
      { name: 'list', description: 'Show all sticky messages', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') {
        const desc = Object.entries(g.stickies).map(([cid, s]) => `• <#${cid}>: ${s.text.slice(0, 60)}`).join('\n') || 'No sticky messages.';
        return ctx.reply({ embeds: [silverEmbed('📌 Sticky Messages', desc)] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      const ch = ctx.getChannel('channel') || ctx.channel;
      if (ctx.sub === 'remove') {
        delete g.stickies[ch.id];
        saveDB();
        return ctx.reply(`Removed sticky message in ${ch}.`);
      }
      const text = ctx.getString('text');
      if (!text) return ctx.reply('Provide sticky message text.');
      const sent = await ch.send({ embeds: [goldEmbed('📌 Sticky Message', text)] });
      g.stickies[ch.id] = { text, lastMessageId: sent.id, count: 0 };
      saveDB();
      return ctx.reply({ content: `Sticky message set in ${ch}.`, ephemeral: true });
    },
  });

  registerCommand({
    name: 'autoreact',
    category: 'Roles & Members',
    description: 'Auto-react to every message in selected channels',
    subcommands: [
      { name: 'add', description: 'Enable auto-reactions in a channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: false }] },
      { name: 'remove', description: 'Disable auto-reactions in a channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: false }] },
      { name: 'list', description: 'Show auto-react channels', default: true },
      { name: 'emojis', description: 'Set up to 3 emojis (space-separated)', options: [{ name: 'emojis', type: 'string', description: 'e.g. ⭐ 🔥 💎', required: false }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') {
        return ctx.reply({ embeds: [silverEmbed('✨ Auto-React', `**Emojis:** ${g.autoreact.emojis.join(' ')}\n**Channels:** ${g.autoreact.channels.map((c) => `<#${c}>`).join(', ') || 'None'}`)] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      const ch = ctx.getChannel('channel') || ctx.channel;
      if (ctx.sub === 'add') { if (!g.autoreact.channels.includes(ch.id)) g.autoreact.channels.push(ch.id); }
      if (ctx.sub === 'remove') g.autoreact.channels = g.autoreact.channels.filter((c) => c !== ch.id);
      if (ctx.sub === 'emojis') {
        const raw = ctx.getString('emojis');
        if (raw) g.autoreact.emojis = raw.trim().split(/\s+/).slice(0, 3);
      }
      saveDB();
      return ctx.reply('Auto-react updated.');
    },
  });

  registerCommand({
    name: 'emojis',
    category: 'Roles & Members',
    description: 'List custom emojis in this server with their embed syntax',
    options: [{ name: 'search', type: 'string', description: 'Filter by name', required: false }],
    async execute(ctx) {
      const q = (ctx.getString('search') || '').toLowerCase();
      const list = [...ctx.guild.emojis.cache.values()].filter((e) => !q || e.name.toLowerCase().includes(q)).slice(0, 25);
      const desc = list.map((e) => `${e} — \`:${e.name}:\` (\`${e.toString()}\`)`).join('\n') || 'No matching custom emojis.';
      return ctx.reply({ embeds: [silverEmbed('😀 Server Custom Emojis', desc)] });
    },
  });
}