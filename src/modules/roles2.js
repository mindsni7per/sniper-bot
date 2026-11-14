import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { registerCommand, hasStaffPerm } from '../registry.js';
import { getGuild, saveDB } from '../db.js';
import { goldEmbed, silverEmbed, parseDuration } from '../config.js';

export async function handleRoles2Interaction(interaction) {
  const g = getGuild(interaction.guildId);

  if (interaction.isButton() && interaction.customId.startsWith('rp_toggle:')) {
    const [, panelName, roleId] = interaction.customId.split(':');
    const rp = g.rolepanels[panelName];
    if (!rp) return interaction.reply({ content: 'Role panel removed.', ephemeral: true });
    if (interaction.member.roles.cache.has(roleId)) {
      await interaction.member.roles.remove(roleId).catch(() => {});
      return interaction.reply({ content: `Removed <@&${roleId}>.`, ephemeral: true });
    }
    if (rp.mode === 'single') {
      for (const r of rp.roles) {
        if (interaction.member.roles.cache.has(r.roleId)) await interaction.member.roles.remove(r.roleId).catch(() => {});
      }
    }
    await interaction.member.roles.add(roleId).catch(() => {});
    return interaction.reply({ content: `Added <@&${roleId}>.`, ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId.startsWith('poll_vote:')) {
    const [, pollId, idxStr] = interaction.customId.split(':');
    const poll = g.polls[pollId];
    if (!poll || poll.closed) return interaction.reply({ content: 'Poll is closed.', ephemeral: true });
    const idx = parseInt(idxStr, 10);
    for (const opt of poll.options) opt.votes = opt.votes.filter((u) => u !== interaction.user.id);
    poll.options[idx].votes.push(interaction.user.id);
    saveDB();
    const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
    const lines = poll.options.map((o, i) => `**${i + 1}. ${o.label}** — ${o.votes.length} votes (${total ? Math.round((o.votes.length / total) * 100) : 0}%)`);
    await interaction.message.edit({ embeds: [goldEmbed(`📊 ${poll.question}`, lines.join('\n'))] }).catch(() => {});
    return interaction.reply({ content: `Voted for **${poll.options[idx].label}**!`, ephemeral: true });
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('app_submit:')) {
    const appName = interaction.customId.split(':')[1];
    const app = g.apps[appName];
    if (!app) return interaction.reply({ content: 'Application form no longer exists.', ephemeral: true });
    const fields = app.questions.map((q, i) => ({ name: q, value: interaction.fields.getTextInputValue(`aq_${i}`) || 'N/A' }));
    const embed = goldEmbed(`📝 New Application — ${app.name}`, `**Applicant:** ${interaction.user} (\`${interaction.user.id}\`)`).addFields(fields);
    const ch = (app.channelId && interaction.guild.channels.cache.get(app.channelId)) || interaction.channel;
    await ch.send({ embeds: [embed] });
    return interaction.reply({ content: '✅ Application submitted!', ephemeral: true });
  }
  return false;
}

export function loadRoles2Module() {
  registerCommand({
    name: 'rolepanel',
    category: 'Roles & Members',
    description: 'Create self-assignable button role panels',
    subcommands: [
      { name: 'create', description: 'Create a role panel', options: [{ name: 'name', type: 'string', description: 'Panel name', required: true }, { name: 'mode', type: 'string', description: 'multi or single', choices: ['multi', 'single'], required: false }, { name: 'description', type: 'string', description: 'Description', required: false }] },
      { name: 'addrole', description: 'Add a role button', options: [{ name: 'panel', type: 'string', description: 'Panel name', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }, { name: 'label', type: 'string', description: 'Button label', required: false }, { name: 'emoji', type: 'string', description: 'Emoji', required: false }] },
      { name: 'removerole', description: 'Remove a role from panel', options: [{ name: 'panel', type: 'string', description: 'Panel name', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }] },
      { name: 'post', description: 'Post the role panel', options: [{ name: 'panel', type: 'string', description: 'Panel name', required: true }, { name: 'channel', type: 'channel', description: 'Channel', required: false }] },
      { name: 'list', description: 'List role panels', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') return ctx.reply({ embeds: [silverEmbed('🎭 Role Panels', Object.values(g.rolepanels).map((p) => `• **${p.name}** (${p.roles.length} roles)`).join('\n') || 'None.')] });
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'create') {
        const name = ctx.getString('name').toLowerCase();
        g.rolepanels[name] = { name, mode: ctx.getString('mode') || 'multi', description: ctx.getString('description') || 'Click a button to toggle a role!', roles: [] };
        saveDB();
        return ctx.reply(`Created role panel **${name}**.`);
      }
      const pName = ctx.getString('panel')?.toLowerCase();
      const rp = g.rolepanels[pName];
      if (!rp) return ctx.reply('Role panel not found.');
      if (ctx.sub === 'addrole') {
        const role = ctx.getRole('role');
        if (!role) return ctx.reply('Specify a role.');
        rp.roles.push({ roleId: role.id, label: ctx.getString('label') || role.name, emoji: ctx.getString('emoji') || null });
        saveDB();
        return ctx.reply(`Added ${role} to **${pName}**.`);
      }
      if (ctx.sub === 'removerole') {
        const role = ctx.getRole('role');
        rp.roles = rp.roles.filter((r) => r.roleId !== role?.id);
        saveDB();
        return ctx.reply('Removed role from panel.');
      }
      if (ctx.sub === 'post') {
        if (!rp.roles.length) return ctx.reply('Add roles first.');
        const ch = ctx.getChannel('channel') || ctx.channel;
        const rows = [];
        for (let i = 0; i < Math.min(25, rp.roles.length); i += 5) {
          const row = new ActionRowBuilder();
          for (const r of rp.roles.slice(i, i + 5)) {
            const btn = new ButtonBuilder().setCustomId(`rp_toggle:${pName}:${r.roleId}`).setLabel(r.label.slice(0, 80)).setStyle(ButtonStyle.Secondary);
            if (r.emoji) btn.setEmoji(r.emoji);
            row.addComponents(btn);
          }
          rows.push(row);
        }
        await ch.send({ embeds: [goldEmbed(`🎭 ${rp.name}`, rp.description)], components: rows });
        return ctx.reply(`Posted **${pName}** in ${ch}.`);
      }
    },
  });

  registerCommand({
    name: 'vanity',
    category: 'Roles & Members',
    description: 'Reward members who put your vanity link in their status',
    subcommands: [
      { name: 'setup', description: 'Set vanity keyword and reward role', options: [{ name: 'code', type: 'string', description: 'Status keyword (e.g. .gg/sniper)', required: true }, { name: 'role', type: 'role', description: 'Reward role', required: true }, { name: 'channel', type: 'channel', description: 'Log channel', required: false }] },
      { name: 'status', description: 'View vanity config', default: true },
      { name: 'off', description: 'Disable vanity tracker' },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'status') return ctx.reply({ embeds: [silverEmbed('🔗 Vanity Role', g.vanity.code ? `Keyword: \`${g.vanity.code}\` → <@&${g.vanity.roleId}>` : 'Not configured.')] });
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'off') { g.vanity = { code: null, roleId: null, channelId: null }; saveDB(); return ctx.reply('Vanity tracker disabled.'); }
      g.vanity = { code: ctx.getString('code'), roleId: ctx.getRole('role')?.id || null, channelId: ctx.getChannel('channel')?.id || null };
      saveDB();
      return ctx.reply(`Vanity tracker set: \`${g.vanity.code}\` → <@&${g.vanity.roleId}>.`);
    },
  });

  registerCommand({
    name: 'tagrole',
    category: 'Roles & Members',
    description: 'Auto-assign a role when a member has a tag in their name',
    subcommands: [
      { name: 'setup', description: 'Configure tag role', options: [{ name: 'tag', type: 'string', description: 'Tag text (e.g. [SNIPER])', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }] },
      { name: 'sync', description: 'Scan members and apply tag role now' },
      { name: 'off', description: 'Disable tag role' },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'off') { g.tagrole = { tag: null, roleId: null }; saveDB(); return ctx.reply('Tagrole disabled.'); }
      if (ctx.sub === 'setup') {
        g.tagrole = { tag: ctx.getString('tag'), roleId: ctx.getRole('role')?.id || null };
        saveDB();
        return ctx.reply(`Tagrole set: \`${g.tagrole.tag}\` → <@&${g.tagrole.roleId}>.`);
      }
      if (ctx.sub === 'sync') {
        if (!g.tagrole.tag || !g.tagrole.roleId) return ctx.reply('Configure `tagrole setup` first.');
        await ctx.guild.members.fetch().catch(() => {});
        let given = 0;
        for (const m of ctx.guild.members.cache.values()) {
          if (m.displayName.includes(g.tagrole.tag) && !m.roles.cache.has(g.tagrole.roleId)) {
            await m.roles.add(g.tagrole.roleId).catch(() => {});
            given++;
          }
        }
        return ctx.reply(`Synced tagrole to **${given}** members.`);
      }
    },
  });

  registerCommand({
    name: 'timezone',
    category: 'Roles & Members',
    description: 'Save and check member timezones',
    subcommands: [
      { name: 'set', description: 'Set your timezone (e.g. Europe/Belgrade, UTC)', options: [{ name: 'zone', type: 'string', description: 'IANA timezone', required: true }] },
      { name: 'view', description: 'Check someone’s local time', default: true, options: [{ name: 'user', type: 'user', description: 'Member', required: false }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'set') {
        const zone = ctx.getString('zone');
        g.timezones[ctx.user.id] = zone;
        saveDB();
        return ctx.reply({ embeds: [goldEmbed('🕒 Timezone Saved', `Your timezone is set to \`${zone}\`.`)] });
      }
      const u = ctx.getUser('user') || ctx.user;
      const zone = g.timezones[u.id];
      if (!zone) return ctx.reply(`${u} hasn't set a timezone yet.`);
      let local = `Zone: ${zone}`;
      try { local = new Date().toLocaleString('en-US', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }); } catch {}
      return ctx.reply({ embeds: [silverEmbed(`🕒 ${u.username}'s Time`, `**Zone:** \`${zone}\`\n**Local Time:** ${local}`)] });
    },
  });

  registerCommand({
    name: 'level',
    category: 'Roles & Members',
    description: 'XP leveling system and role rewards',
    subcommands: [
      { name: 'rank', description: 'Check level & XP', default: true, options: [{ name: 'user', type: 'user', description: 'Member', required: false }] },
      { name: 'top', description: 'XP leaderboard' },
      { name: 'setup', description: '(Staff) Configure leveling', options: [{ name: 'enabled', type: 'boolean', description: 'On/Off', required: false }, { name: 'channel', type: 'channel', description: 'Level-up channel', required: false }, { name: 'xp', type: 'integer', description: 'XP per message', required: false }] },
      { name: 'reward', description: '(Staff) Add level role reward', options: [{ name: 'level', type: 'integer', description: 'Level', required: true }, { name: 'role', type: 'role', description: 'Role', required: true }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'rank') {
        const u = ctx.getUser('user') || ctx.user;
        const d = g.levels[u.id] || { xp: 0, level: 0 };
        return ctx.reply({ embeds: [goldEmbed(`⚡ Rank — ${u.username}`, `• **Level:** ${d.level}\n• **XP:** ${d.xp} / ${(d.level + 1) * 100}`)] });
      }
      if (ctx.sub === 'top') {
        const sorted = Object.entries(g.levels).sort((a, b) => (b[1].level * 100000 + b[1].xp) - (a[1].level * 100000 + a[1].xp)).slice(0, 10);
        return ctx.reply({ embeds: [goldEmbed('⚡ Level Leaderboard', sorted.map(([id, d], i) => `**${i + 1}.** <@${id}> — Level **${d.level}** (${d.xp} XP)`).join('\n') || 'No XP earned yet.')] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      if (ctx.sub === 'setup') {
        if (ctx.getBoolean('enabled') !== null) g.levelConfig.enabled = ctx.getBoolean('enabled');
        if (ctx.getChannel('channel')) g.levelConfig.channelId = ctx.getChannel('channel').id;
        if (ctx.getInteger('xp')) g.levelConfig.xpPerMsg = ctx.getInteger('xp');
        saveDB();
        return ctx.reply('Level config saved.');
      }
      if (ctx.sub === 'reward') {
        g.levelConfig.rewards.push({ level: ctx.getInteger('level'), roleId: ctx.getRole('role')?.id });
        saveDB();
        return ctx.reply('Level reward added.');
      }
    },
  });

  registerCommand({
    name: 'antinuke',
    category: 'Roles & Members',
    description: 'Protect the server from mass deletions or bans',
    subcommands: [
      { name: 'toggle', description: 'Enable/disable anti-nuke', options: [{ name: 'enabled', type: 'boolean', description: 'On/Off', required: true }, { name: 'logchannel', type: 'channel', description: 'Alert channel', required: false }] },
      { name: 'whitelist', description: 'Whitelist a trusted admin', options: [{ name: 'action', type: 'string', description: 'add/remove', choices: ['add', 'remove'], required: true }, { name: 'user', type: 'user', description: 'User', required: true }] },
      { name: 'status', description: 'View anti-nuke status', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'status') return ctx.reply({ embeds: [silverEmbed('🛡️ Anti-Nuke', `• Enabled: **${g.antinuke.enabled}**\n• Log: ${g.antinuke.logChannel ? `<#${g.antinuke.logChannel}>` : 'None'}\n• Whitelist: ${g.antinuke.whitelist.map((u) => `<@${u}>`).join(', ') || 'Owner only'}`)] });
      if (ctx.user.id !== ctx.guild.ownerId && !hasStaffPerm(ctx.member, g)) return ctx.reply('Admin/Owner permission required.');
      if (ctx.sub === 'toggle') {
        g.antinuke.enabled = ctx.getBoolean('enabled');
        if (ctx.getChannel('logchannel')) g.antinuke.logChannel = ctx.getChannel('logchannel').id;
      }
      if (ctx.sub === 'whitelist') {
        const u = ctx.getUser('user');
        if (ctx.getString('action') === 'add' && u && !g.antinuke.whitelist.includes(u.id)) g.antinuke.whitelist.push(u.id);
        if (ctx.getString('action') === 'remove' && u) g.antinuke.whitelist = g.antinuke.whitelist.filter((x) => x !== u.id);
      }
      saveDB();
      return ctx.reply('Anti-nuke updated.');
    },
  });

  registerCommand({
    name: 'boost',
    category: 'Roles & Members',
    description: 'Server boost announcements and booster list',
    subcommands: [
      { name: 'setup', description: '(Staff) Set boost thank-you channel', options: [{ name: 'channel', type: 'channel', description: 'Channel', required: true }, { name: 'message', type: 'string', description: 'Message ({user}, {server})', required: false }] },
      { name: 'list', description: 'Show current server boosters', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') {
        await ctx.guild.members.fetch().catch(() => {});
        const boosters = ctx.guild.members.cache.filter((m) => m.premiumSince);
        return ctx.reply({ embeds: [goldEmbed(`💎 Server Boosters (Level ${ctx.guild.premiumTier} • ${ctx.guild.premiumSubscriptionCount} boosts)`, boosters.map((m) => `• ${m}`).join('\n') || 'No active boosters.')] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      g.boostConfig.channelId = ctx.getChannel('channel')?.id || null;
      if (ctx.getString('message')) g.boostConfig.message = ctx.getString('message');
      saveDB();
      return ctx.reply('Boost announcement channel saved.');
    },
  });

  registerCommand({
    name: 'loa',
    category: 'Roles & Members',
    description: 'Staff Leave of Absence (LOA) requests',
    subcommands: [
      { name: 'request', description: 'Request a leave of absence', options: [{ name: 'duration', type: 'string', description: 'e.g. 5d, 2w', required: true }, { name: 'reason', type: 'string', description: 'Reason', required: true }] },
      { name: 'end', description: 'End your active LOA early' },
      { name: 'list', description: 'View active LOAs', default: true },
      { name: 'setup', description: '(Admin) Configure LOA role & log channel', options: [{ name: 'role', type: 'role', description: 'LOA role', required: false }, { name: 'logchannel', type: 'channel', description: 'Log channel', required: false }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') return ctx.reply({ embeds: [silverEmbed('🏖️ Active LOAs', g.loas.map((l) => `• <@${l.userId}> until <t:${Math.floor(l.endsAt / 1000)}:D> — ${l.reason}`).join('\n') || 'Nobody is on LOA.')] });
      if (ctx.sub === 'setup') {
        if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Admin required.');
        if (ctx.getRole('role')) g.loaConfig.roleId = ctx.getRole('role').id;
        if (ctx.getChannel('logchannel')) g.loaConfig.logChannel = ctx.getChannel('logchannel').id;
        saveDB();
        return ctx.reply('LOA config saved.');
      }
      if (ctx.sub === 'request') {
        const ms = parseDuration(ctx.getString('duration'));
        if (!ms) return ctx.reply('Invalid duration.');
        const reason = ctx.getString('reason');
        g.loas = g.loas.filter((l) => l.userId !== ctx.user.id);
        g.loas.push({ userId: ctx.user.id, endsAt: Date.now() + ms, reason });
        if (g.loaConfig.roleId) await ctx.member.roles.add(g.loaConfig.roleId).catch(() => {});
        saveDB();
        return ctx.reply({ embeds: [goldEmbed('🏖️ LOA Recorded', `${ctx.user} is on LOA until <t:${Math.floor((Date.now() + ms) / 1000)}:D>.\nReason: ${reason}`)] });
      }
      if (ctx.sub === 'end') {
        g.loas = g.loas.filter((l) => l.userId !== ctx.user.id);
        if (g.loaConfig.roleId) await ctx.member.roles.remove(g.loaConfig.roleId).catch(() => {});
        saveDB();
        return ctx.reply('Your LOA has ended. Welcome back!');
      }
    },
  });

  registerCommand({
    name: 'paidtag',
    category: 'Roles & Members',
    description: 'Manage custom paid/VIP tags for members',
    subcommands: [
      { name: 'set', description: '(Staff) Grant a paid tag', options: [{ name: 'user', type: 'user', description: 'Member', required: true }, { name: 'tag', type: 'string', description: 'Tag text', required: true }] },
      { name: 'remove', description: '(Staff) Remove a paid tag', options: [{ name: 'user', type: 'user', description: 'Member', required: true }] },
      { name: 'view', description: 'Check a member paid tag', default: true, options: [{ name: 'user', type: 'user', description: 'Member', required: false }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'view') {
        const u = ctx.getUser('user') || ctx.user;
        return ctx.reply({ embeds: [goldEmbed('🏷️ Paid Tag', g.paidtags[u.id] ? `${u}: **${g.paidtags[u.id]}**` : `${u} has no paid tag.`)] });
      }
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      const u = ctx.getUser('user');
      if (!u) return ctx.reply('Specify user.');
      if (ctx.sub === 'set') { g.paidtags[u.id] = ctx.getString('tag'); saveDB(); return ctx.reply(`Set paid tag for ${u}.`); }
      if (ctx.sub === 'remove') { delete g.paidtags[u.id]; saveDB(); return ctx.reply(`Removed paid tag for ${u}.`); }
    },
  });

  registerCommand({
    name: 'admin',
    category: 'Roles & Members',
    description: 'Quick server overview and admin tools',
    subcommands: [
      { name: 'info', description: 'Bot & server diagnostics', default: true },
      { name: 'say', description: '(Admin) Send a message as the bot', options: [{ name: 'text', type: 'string', description: 'Message', required: true }, { name: 'channel', type: 'channel', description: 'Channel', required: false }] },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Admin permission required.');
      if (ctx.sub === 'say') {
        const ch = ctx.getChannel('channel') || ctx.channel;
        await ch.send(ctx.getString('text'));
        return ctx.reply({ content: 'Sent.', ephemeral: true });
      }
      const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
      return ctx.reply({ embeds: [goldEmbed('🛡️ Admin Diagnostics', `• Guild: **${ctx.guild.name}** (\`${ctx.guild.memberCount}\` members)\n• Ping: \`${ctx.client.ws.ping}ms\`\n• RAM: \`${memMB} MB\`\n• Prefix: \`s!\` & Slash \`/\``)] });
    },
  });

  registerCommand({
    name: 'poll',
    category: 'Roles & Members',
    description: 'Create an interactive button poll',
    options: [
      { name: 'question', type: 'string', description: 'Poll question', required: true },
      { name: 'options', type: 'string', description: 'Options separated by | (e.g. Yes | No)', required: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      const question = ctx.getString('question');
      const opts = (ctx.getString('options') || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 5);
      if (!question || opts.length < 2) return ctx.reply('Provide a question and at least 2 options separated by `|`.');
      const id = Date.now().toString(36);
      g.polls[id] = { question, options: opts.map((label) => ({ label, votes: [] })), closed: false };
      saveDB();
      const row = new ActionRowBuilder().addComponents(
        opts.map((label, i) => new ButtonBuilder().setCustomId(`poll_vote:${id}:${i}`).setLabel(label.slice(0, 80)).setStyle(ButtonStyle.Primary))
      );
      return ctx.reply({ embeds: [goldEmbed(`📊 ${question}`, opts.map((o, i) => `**${i + 1}. ${o}** — 0 votes (0%)`).join('\n'))], components: [row] });
    },
  });

  registerCommand({
    name: 'apps',
    category: 'Roles & Members',
    description: '(Staff) Create and manage application forms',
    subcommands: [
      { name: 'create', description: 'Create an application form', options: [{ name: 'name', type: 'string', description: 'Form name', required: true }, { name: 'questions', type: 'string', description: 'Up to 5 questions separated by |', required: true }, { name: 'channel', type: 'channel', description: 'Review channel', required: false }] },
      { name: 'delete', description: 'Delete an application form', options: [{ name: 'name', type: 'string', description: 'Form name', required: true }] },
      { name: 'list', description: 'List application forms', default: true },
    ],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      if (ctx.sub === 'list') return ctx.reply({ embeds: [silverEmbed('📝 Application Forms', Object.values(g.apps).map((a) => `• **${a.name}** (${a.questions.length} questions)`).join('\n') || 'No forms created.')] });
      if (!hasStaffPerm(ctx.member, g)) return ctx.reply('Staff permission required.');
      const name = ctx.getString('name')?.toLowerCase();
      if (ctx.sub === 'create') {
        const qs = (ctx.getString('questions') || '').split('|').map((s) => s.trim()).filter(Boolean).slice(0, 5);
        if (!name || !qs.length) return ctx.reply('Provide a name and questions separated by `|`.');
        g.apps[name] = { name, questions: qs, channelId: ctx.getChannel('channel')?.id || null };
        saveDB();
        return ctx.reply({ embeds: [goldEmbed('✅ Form Created', `Members can now apply using \`/apply ${name}\`.`)] });
      }
      if (ctx.sub === 'delete') { delete g.apps[name]; saveDB(); return ctx.reply(`Deleted form **${name}**.`); }
    },
  });

  registerCommand({
    name: 'apply',
    category: 'Roles & Members',
    description: 'Submit an application form',
    options: [{ name: 'form', type: 'string', description: 'Application form name', required: true }],
    async execute(ctx) {
      const g = getGuild(ctx.guildId);
      const name = (ctx.getString('form') || '').toLowerCase();
      const app = g.apps[name];
      if (!app) return ctx.reply('Application form not found. Use `/apps list` to see available forms.');
      if (!ctx.isSlash) return ctx.reply(`Please use the slash command \`/apply form:${name}\` to open the application modal!`);
      const modal = new ModalBuilder().setCustomId(`app_submit:${name}`).setTitle(`Apply: ${app.name}`.slice(0, 45));
      for (let i = 0; i < app.questions.length; i++) {
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(`aq_${i}`).setLabel(app.questions[i].slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true)
        ));
      }
      await ctx.interaction.showModal(modal);
    },
  });
}