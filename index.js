
require('dotenv').config();
const { baslatMacTakibi } = require('./maclar');

const fs = require('node:fs');
const path = require('node:path');

const {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
    SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const ffmpegPath = process.platform === 'android'
  ? '/data/data/com.termux/files/usr/bin/ffmpeg'
  : require('ffmpeg-static');

const MUSIC_VOICE_CHANNEL_ID = '1565642176564695140';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} = require('discord.js');

const ticketCategories = [
  {
    label: 'Discord Sorunu',
    description: 'Discord ile ilgili sorunlar',
    value: 'discord',
    emoji: '🎮'
  },
  {
    label: 'Üye Şikâyeti',
    description: 'Bir üyeyi şikâyet et',
    value: 'uye',
    emoji: '🚨'
  },
  {
    label: 'Yetkili Şikâyeti',
    description: 'Bu ticket yalnızca Owner yetkilileri tarafından görüntülenir.',
    value: 'yetkili',
    emoji: '⚖️'
  },
  {
    label: 'Diğer',
    description: 'Diğer destek talepleri',
    value: 'diger',
    emoji: '🎫'
  }
];

const ticketMenu = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('xrx_ticket_select')
      .setPlaceholder('📋 Bir kategori seç')
      .addOptions(ticketCategories)
  );

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});
let musicConnection = null;
let musicPlayer = null;
let currentStation = null;

const MUSIC_STATIONS = {
  xrx_music_trrap: {
    name: 'Türkçe Rap',
    url: 'https://stream.xradio.com.tr:8770/stream'
  },
  xrx_music_trpop: {
    name: 'Türkçe Pop',
    url: 'RADYO_YAYIN_ADRESI'
  },
  xrx_music_foreign: {
    name: 'Yabancı Rap',
    url: 'RADYO_YAYIN_ADRESI'
  }
};

// Mesaj sayıları sadece RAM'de tutulur, dosyaya kaydedilmez.
let messageCounts = {};



// XRX Anti-Spam — geçici bellek, dosyaya kayıt yok
const spamTracker = new Map();

const SPAM_WINDOW_MS = 6000;
const SPAM_LIMIT = 5;
const SPAM_RESET_MS = 10 * 60 * 1000; // 10 dakika

// Slash komutu

   const commands = [
    new SlashCommandBuilder()
        .setName('mesajlar')
        .setDescription('En çok mesaj atan ilk 10 üyeyi gösterir'),

    new SlashCommandBuilder()
        .setName('guvenlik')
        .setDescription('Bir Discord hesabının güvenlik risklerini kontrol eder')
        .addUserOption(option =>
            option
                .setName('uye')
                .setDescription('Kontrol edilecek Discord üyesi')
                .setRequired(true)
                
        ),
            new SlashCommandBuilder()
        .setName('ticketpanel')
        .setDescription('XRX destek panelini oluşturur'),

    new SlashCommandBuilder()
        .setName('etkinlik')
        .setDescription('Yeni bir XRX etkinliği oluşturur')
        .addStringOption(option =>
            option
                .setName('ad')
                .setDescription('Etkinliğin adı')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                        .setName('odul')
        .setDescription('Etkinliğin ödülü')
        .setRequired(true)
)
.addIntegerOption(option =>
    option
        .setName('sure')
        .setDescription('Etkinlik kaç dakika sürecek?')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(10080)
),

        
    new SlashCommandBuilder()
        .setName('etkinlikbitir')
        .setDescription('Etkinliği bitirir ve kazananı duyurur')
        .addStringOption(option =>
            option
                .setName('kazanan')
                .setDescription('Kazanan kişinin Discord kullanıcı IDsi')
                .setRequired(true)
        ),
            new SlashCommandBuilder()
        .setName('başvurupanel')
        .setDescription('XRX özel rol başvuru panelini oluşturur'),

             new SlashCommandBuilder()
        .setName('musicpanel')
        .setDescription('XRX müzik panelini oluşturur')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

client.once(Events.ClientReady, async () => {
  console.log(`${client.user.tag} aktif oldu!`);

  if (!process.env.GUILD_ID) {
    console.error('.env dosyasında GUILD_ID eksik!');
    return;
  }

  try {
    const rest = new REST({ version: '10' })
      .setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        process.env.GUILD_ID
      ),
      { body: commands.map(command => command.toJSON()) }
    );

    console.log('/mesajlar komutu kaydedildi!');
  } catch (error) {
    console.error('Komut kaydedilemedi:', error);
  }
});

// Hoş geldin mesajı
client.on(Events.GuildMemberAdd, member => {
  const kanal = member.guild.systemChannel;

  if (kanal) {
    kanal.send(`Hoş geldin ${member}! XRX ailesine hoş geldin!`);
  }
});

// Mesajları say ve eski cevapları koru
client.on(Events.MessageCreate, async message => {
  if (message.author.bot || !message.guild) return;
    // XRX ANTİ-SPAM
  const spamKey = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();

  let spam = spamTracker.get(spamKey);

  if (!spam) {
    spam = {
      recent: [],
      violations: 0,
      lastViolationAt: 0,
      active: false
    };

    spamTracker.set(spamKey, spam);
  }

  // Son 3 saniyedeki mesajları tut
  spam.recent = spam.recent.filter(
    item => now - item.time < SPAM_WINDOW_MS
  );

  spam.recent.push({
    time: now,
    message: message
  });

  if (spam.recent.length < SPAM_LIMIT) {
    spam.active = false;
  }

  // 3 saniyede 5 mesaj: yalnızca bir kez ceza ver
  if (spam.recent.length >= SPAM_LIMIT && !spam.active) {
    spam.active = true;

    // Son ihlalden 10 dakika geçtiyse ceza sayacını sıfırla
    if (now - spam.lastViolationAt >= SPAM_RESET_MS) {
      spam.violations = 0;
    }

    spam.violations++;
    spam.lastViolationAt = now;

    const ceza = Math.min(spam.violations, 3);

    // Spam yapan üyenin son mesajlarını sil
    await message.channel.bulkDelete(
      spam.recent.map(item => item.message),
      true
    ).catch(error => {
      console.error('XRX Anti-Spam mesaj silme hatası:', error);
    });

    if (ceza >= 3) {
      let timeoutBasarili = false;

      try {
        await message.member.timeout(
          5 * 60 * 1000,
          'XRX Anti-Spam: 3. ihlal'
        );

        timeoutBasarili = true;
      } catch (error) {
        console.error('XRX Anti-Spam timeout hatası:', error);
      }

      await message.channel.send(
        `🔨 **XRX | Anti-Spam**\n` +
        `👤 Üye: ${message.author}\n` +
        `⚠️ Ceza: **3/3**\n` +
        `📝 Sebep: Mesaj spamı\n` +
        (timeoutBasarili
          ? '⏳ **5 dakika zaman aşımı uygulandı.**'
          : '❌ Timeout uygulanamadı. Botun izinlerini kontrol edin.')
      ).catch(() => {});

      // Üçüncü cezadan sonra yeni seri için sıfırla
      spam.violations = 0;
    } else {
      await message.channel.send(
        `⚠️ **XRX | Anti-Spam**\n` +
        `👤 Üye: ${message.author}\n` +
        `⚠️ Ceza: **3/${ceza}**\n` +
        `📝 Sebep: Mesaj spamı\n` +
        (ceza === 1
          ? 'İlk ihlal: Uyarı verildi.'
          : 'İkinci ihlal: Son uyarı!')
      ).catch(() => {});
    }
  }
  
  const guildId = message.guild.id;
  
  const userId = message.author.id;

  if (!messageCounts[guildId]) {
    messageCounts[guildId] = {};
  }

  messageCounts[guildId][userId] =
    (messageCounts[guildId][userId] || 0) + 1;

  
  const yazi = message.content.trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i');

  if (['sa', 'naber'].includes(yazi)) {
  if (yazi === 'sa') message.reply('Aleyküm selam');
  if (yazi === 'naber') message.reply('İyilik senden');
}

if (['günaydın', 'gunaydin', 'günaydin', 'gunaydın'].includes(yazi)) {
  message.reply('Günaydın Uykucu ☀️');
}
});

// /mesajlar komutu
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'mesajlar') return;

  const counts = messageCounts[interaction.guildId] || {};

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6)
    .setTitle('🏆 XRX | En Çok Mesaj Atanlar')
    .setDescription(
      top.length
        ? top.map(([id, count], index) =>
            `**${index + 1}.** <@${id}> — **${count}** mesaj`
          ).join('\n')
        : 'Henüz mesaj kaydı yok. Mesajlar geldikçe sıralama oluşacak.'
    )
    .setFooter({ text: 'XRX • Mesaj sıralaması' });

  await interaction.reply({ embeds: [embed] });
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'guvenlik') return;

  const member = interaction.options.getUser('uye');
  const guildMember = await interaction.guild.members.fetch(member.id);

  const hesapTarihi = Math.floor(member.createdTimestamp / 1000);
  const katilmaTarihi = Math.floor(guildMember.joinedTimestamp / 1000);
  const hesapYasi = Math.floor(
    (Date.now() - member.createdTimestamp) / 86400000
  );

  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6)
    .setTitle('🛡️ XRX | Güvenlik Raporu')
    .setThumbnail(member.displayAvatarURL())
    .addFields(
      { name: '👤 Üye', value: `${member}`, inline: false },
      { name: '📅 Hesap oluşturulma', value: `<t:${hesapTarihi}:F>`, inline: false },
      { name: '📥 Sunucuya katılma', value: `<t:${katilmaTarihi}:F>`, inline: false },
      { name: '⏳ Hesap yaşı', value: `${hesapYasi} gün`, inline: true },
      {
        name: '🔎 Kontrol',
        value: hesapYasi < 7
          ? '⚠️ Çok yeni hesap — dikkatli inceleyin.'
          : hesapYasi < 30
            ? '🟡 Yeni hesap — ek kontrol önerilir.'
            : '✅ Hesap 30 günden eski.',
        inline: true
      }
    )
    .setFooter({ text: 'XRX • Otomatik güvenlik kontrolü' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'etkinlik') return;

  const ad = interaction.options.getString('ad');
  const odul = interaction.options.getString('odul');
  const sure = interaction.options.getInteger('sure');

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

  const embed = new EmbedBuilder()
    .setColor(0x8B5CF6)
    .setTitle(`🎉 ${ad}`)
    .setDescription(
      `**XRX ETKİNLİĞİ**\n\n` +
      `🏆 **Ödül:** ${odul}\n\n` +
      `Katılmak için aşağıdaki butona bas!`
    )
    .addFields({
      name: '👥 Katılımcılar',
      value: 'Henüz katılımcı yok.'
    })
    .setFooter({ text: 'XRX SYSTEM • Etkinlik' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('xrx_etkinlik_katil')
      .setLabel('Katıl')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('xrx_etkinlik_ayril')
      .setLabel('Ayrıl')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary)
  );
const bitisZamani = Date.now() + sure * 60 * 1000;
  await interaction.reply({
    embeds: [embed],
    components: [row]
  });
  
  const etkinlikMesaji = await interaction.fetchReply();
  console.log('XRX GERİ SAYIM BAŞLADI:', etkinlikMesaji.id, 'Süre:', sure);

  const zamanlayici = setInterval(async () => {
    try {
      const kalan = bitisZamani - Date.now();
      const mesaj = await interaction.channel.messages.fetch(etkinlikMesaji.id);
      const guncelEmbed = EmbedBuilder.from(mesaj.embeds[0]);

      if (kalan <= 0) {
        clearInterval(zamanlayici);

        const katilimcilar =
          etkinlikKatilimcilari.get(etkinlikMesaji.id) || new Set();

        const liste = [...katilimcilar];
        const kazanan = liste.length
          ? liste[Math.floor(Math.random() * liste.length)]
          : null;

        guncelEmbed
          .setColor(0x22C55E)
          .setDescription(
            `**XRX ETKİNLİĞİ BİTTİ!**\n\n` +
            `🏆 **Ödül:** ${odul}\n` +
            (kazanan
              ? `🎉 **Kazanan:** <@${kazanan}>`
              : 'Katılımcı olmadığı için kazanan belirlenemedi.')
          );

        const kapaliSatir = new ActionRowBuilder().addComponents(
          ...row.components.map(button =>
            ButtonBuilder.from(button).setDisabled(true)
          )
        );

        await mesaj.edit({
          embeds: [guncelEmbed],
          components: [kapaliSatir]
        });

        return;
      }

      const saniye = Math.floor(kalan / 1000);
      const dakika = Math.floor(saniye / 60);
      const kalanSaniye = saniye % 60;

      guncelEmbed.setDescription(
        `**XRX ETKİNLİĞİ**\n\n` +
        `🏆 **Ödül:** ${odul}\n` +
        `🕒 **Bitiş:** <t:${Math.floor(bitisZamani / 1000)}:F>\n` +
        `⏳ **Kalan:** ${dakika} dakika ${kalanSaniye} saniye\n\n` +
        `Katılmak için aşağıdaki butona bas!`
      );

      await mesaj.edit({ embeds: [guncelEmbed] });
    } catch (error) {
      clearInterval(zamanlayici);
      console.error('Etkinlik zamanlayıcı hatası:', error);
    }
  }, 10000);

});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'etkinlikbitir') return;

  if (!interaction.memberPermissions?.has('ManageEvents')) {
    await interaction.reply({
      content: 'Bu komutu kullanmak için etkinlikleri yönetme yetkin olmalı.',
      ephemeral: true
    });
    return;
  }

  const kazananId = interaction.options.getString('kazanan');

  await interaction.reply({
    content: `🏆 **XRX ETKİNLİĞİ BİTTİ!**\nKazanan: <@${kazananId}>\nTebrikler! 🎉`
  });
});


const etkinlikKatilimcilari = new Map();

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const id = interaction.message.id;
  const kullaniciId = interaction.user.id;

  if (
    interaction.customId !== 'xrx_etkinlik_katil' &&
    interaction.customId !== 'xrx_etkinlik_ayril'
  ) return;

  if (!etkinlikKatilimcilari.has(id)) {
    etkinlikKatilimcilari.set(id, new Set());
  }

  const katilimcilar = etkinlikKatilimcilari.get(id);

  if (interaction.customId === 'xrx_etkinlik_katil') {
    if (katilimcilar.has(kullaniciId)) {
      await interaction.reply({
        content: 'Zaten etkinliğe katılmışsın!',
        ephemeral: true
      });
      return;
    }

    katilimcilar.add(kullaniciId);
  } else {
    if (!katilimcilar.has(kullaniciId)) {
      await interaction.reply({
        content: 'Zaten katılımcı listesinde değilsin!',
        ephemeral: true
      });
      return;
    }

    katilimcilar.delete(kullaniciId);
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0]);

  embed.setFields({
    name: '👥 Katılımcılar (' + katilimcilar.size + ')',
    value: katilimcilar.size
      ? [...katilimcilar].map((id, i) => `${i + 1}. <@${id}>`).join('\n')
      : 'Henüz katılımcı yok.'
  });

  await interaction.update({ embeds: [embed] });
});



client.on(Events.InteractionCreate, async interaction => {
  try {
    // Ticket panelini gönder
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === 'ticketpanel'
    ) {
      const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('🎫 XRX | Destek Merkezi')
        .setDescription(
          'Desteğe mi ihtiyacın var?\n\n' +
          'Aşağıdaki menüden bir kategori seçerek destek talebi oluşturabilirsin.'
        )
        .setFooter({ text: 'XRX SYSTEM • Destek' });

      await interaction.channel.send({
        embeds: [embed],
        components: [ticketMenu]
      });

      await interaction.reply({
        content: '✅ Ticket paneli gönderildi!',
        ephemeral: true
      });
      return;
    }

    // Kategori seçilince özel kanal aç
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'xrx_ticket_select'
    ) {
      const selected = ticketCategories.find(
        category => category.value === interaction.values[0]
      );

      if (!selected || !interaction.guild) {
        await interaction.reply({
          content: '❌ Kategori bulunamadı.',
          ephemeral: true
        });
        return;
      }

      const channelName =
        `ticket-${selected.value}-${interaction.user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .slice(0, 90);

      const ticketChannel = await interaction.guild.channels.create({
  name: channelName || `ticket-${selected.value}`,
  type: ChannelType.GuildText,
  parent: "1510938621136605296",
  permissionOverwrites: [
  {
    id: interaction.guild.id,
    deny: [PermissionFlagsBits.ViewChannel]
  },
  ...(selected.value === 'yetkili'
    ? [
        {
          id: '1502575396066033674',
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }
      ]
    : [
        {
          id: '1563238275848732712',
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        },
        {
          id: '1502581042140155985',
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        },
        {
          id: '1502575696256696512',
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory
          ]
        }
      ]),
  {
    id: interaction.user.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory
    ]
  },
  {
    id: client.user.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageChannels
    ]
  }
]
      });

      const closeButton = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('xrx_ticket_close')
            .setLabel('Ticket Kapat')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger)
        );

      await ticketChannel.send({
        content:
          `Merhaba ${interaction.user}!\n` +
          `**Kategori:** ${selected.emoji} ${selected.label}\n\n` +
          'Sorununu burada açıklayabilirsin. Bir yetkili seninle ilgilenecek.',
        components: [closeButton]
      });

      await interaction.reply({
        content: `✅ Ticket kanalın oluşturuldu: ${ticketChannel}`,
        ephemeral: true
      });
      return;
    }

    
    // Ticket kapatma butonu
    if (
      interaction.isButton() &&
      interaction.customId === 'xrx_ticket_close'
    ) {
      const channel = interaction.channel;
      const isAdmin = interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageChannels
      );

      if (!isAdmin) {
        const isTicketOwner =
          channel.permissionOverwrites.cache.has(interaction.user.id);
          if (!isTicketOwner) {
  await interaction.reply({
    content: '❌ Bu ticketı kapatma yetkin yok.',
    ephemeral: true
  });
  return;
}

await channel.permissionOverwrites.edit(interaction.user.id, {
  ViewChannel: false,
  SendMessages: false
});

await interaction.reply({
  content: '🔒 Ticket senin için kapatıldı. Yetkililer incelemeye devam edebilir.',
  ephemeral: true
});
return;

        if (!isTicketOwner) {
          await interaction.reply({
            content: '❌ Bu ticketı kapatma yetkin yok.',
            ephemeral: true
          });
          return;
        }

        await channel.permissionOverwrites.edit(interaction.user.id, {
          ViewChannel: false,
          SendMessages: false
        });

        await interaction.reply({
          content: '🔒 Ticket senin için kapatıldı. Yetkililer incelemeye devam edebilir.',
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: '🔒 Ticket kapatılıyor...'
      });

      setTimeout(() => {
        channel.delete().catch(console.error);
      }, 5000);
      return;
    }

  } catch (error) {
    console.error('Ticket hatası:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Bir hata oluştu. Bot konsolunu kontrol edin.',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

  

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'musicpanel') return;

    const {
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle
    } = require('discord.js');
    const { createAudioResource: createResource } = require('@discordjs/voice');
const play = require('play-dl');
        const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('🎵 XRX MUSIC SYSTEM')
        .setDescription(
            '**XRX Müzik Paneline Hoş Geldin!**\n\n' +
            '🎧 Aşağıdaki butonlarla müziği kontrol edebilirsin.\n\n' +
            '**Radyo Kanalları**\n' +
            '🇹🇷 Türkçe Rap\n' +
            '🎤 Türkçe Pop\n' +
            '🌍 Yabancı Rap\n\n' +
            '**Müzik Kontrolleri**\n' +
            '➕ Şarkı ekle\n' +
            '⏸️ Duraklat\n' +
            '⏭️ Geç\n' +
            '📜 Sıra'
        )
        .setFooter({ text: 'XRX SYSTEM • MUSIC' });

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('xrx_music_trrap')
            .setLabel('Türkçe Rap')
            .setEmoji('🇹🇷')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('xrx_music_trpop')
            .setLabel('Türkçe Pop')
            .setEmoji('🎤')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('xrx_music_foreign')
            .setLabel('Yabancı Rap')
            .setEmoji('🌍')
            .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('xrx_music_add')
            .setLabel('Şarkı Ekle')
            .setEmoji('➕')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('xrx_music_pause')
            .setLabel('Duraklat')
            .setEmoji('⏸️')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('xrx_music_skip')
            .setLabel('Geç')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('xrx_music_queue')
            .setLabel('Sıra')
            .setEmoji('📜')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
        embeds: [embed],
        components: [row1, row2]
    });
});
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('xrx_music_')) {
    await interaction.reply({
        content: '🎵 Müzik sistemi geçici olarak kapalı.',
        ephemeral: true
    });
    return;
}

    const station = MUSIC_STATIONS[interaction.customId];
    if (!station) return;

    try {
        await interaction.deferReply({ ephemeral: true });

        const voiceChannel = await interaction.guild.channels.fetch('1565642176564695140');

       
        await entersState(musicConnection, VoiceConnectionStatus.Ready, 20000);

        if (!musicPlayer) {
            musicPlayer = createAudioPlayer();
        }

        musicConnection.subscribe(musicPlayer);
        const { spawn } = require('child_process');

const ffmpeg = spawn(ffmpegPath, [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', station.url,
    '-analyzeduration', '0',
    '-loglevel', '0',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1'
]);

const resource = createAudioResource(ffmpeg.stdout, {
    inputType: 'raw'
});

musicPlayer.play(resource);

        await interaction.editReply(`🎵 ${station.name} yayını başlatıldı!`);
return;

    } catch (error) {
        console.error('Müzik bağlantı hatası:', error);

        await interaction.editReply('❌ Ses kanalına bağlanamadım. Terminali kontrol et.');
    }
});

const APP_CHANNEL_ID = '1566391536218804244';
const APP_OWNER_ROLE_ID = '1502575396066033674';

// XRX Özel Rol Başvuru Sistemi
client.on(Events.InteractionCreate, async interaction => {
  try {
    // Başvuru paneli komutu
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === 'başvurupanel'
    ) {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (!member.roles.cache.has(APP_OWNER_ROLE_ID)) {
        return interaction.reply({
          content: '❌ Bu komutu yalnızca Owner kullanabilir.',
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('XRX | Özel Rol Başvuruları')
        .setDescription(
          'Özel rol sahibi olmak istiyorsan aşağıdaki butona basarak başvurunu gönderebilirsin.\n\n' +
          '🌟 **Başvurulabilecek roller:** Legend – Senior Manager\n' +
          
          '📌 Başvurular yönetim ekibi tarafından incelenecektir.'
        )
        .setFooter({ text: 'XRX SYSTEM • Başvuru Sistemi' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('xrx_app_start')
          .setLabel('Başvur')
          .setEmoji('🌟')
          .setStyle(ButtonStyle.Primary)
      );

      await interaction.channel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.reply({
  content: '✅ Başvuru paneli gönderildi!',
  ephemeral: true
});
    }

    // Başvuru formunu aç
    if (
      interaction.isButton() &&
      interaction.customId === 'xrx_app_start'
    ) {
      const {
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle
      } = require('discord.js');

      const modal = new ModalBuilder()
        .setCustomId('xrx_app_modal')
        .setTitle('XRX Özel Rol Başvurusu');

      const questions = [
        ['app_role', 'Hangi özel rolü istiyorsun?', true],
        ['app_reason', 'Bu rolü neden istiyorsun?', true],
        ['app_deserve', 'Bu rolü neden hak ettiğini düşünüyorsun?', true],
        ['app_activity', 'Ne sıklıkla yazıyorsun?', true],
        ['app_extra', 'Eklemek istediğin bir şey var mı?', false]
      ];

      modal.addComponents(
        ...questions.map(([id, label, required]) =>
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId(id)
              .setLabel(label)
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(required)
              .setMaxLength(500)
          )
        )
      );

      return interaction.showModal(modal);
    }

    // Başvuruyu gönder
    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'xrx_app_modal'
    ) {
      const channel = await interaction.guild.channels.fetch(APP_CHANNEL_ID);

      if (!channel || !channel.isTextBased()) {
        return interaction.reply({
          content: '❌ Başvuru kanalı bulunamadı.',
          ephemeral: true
        });
      }

      const cevaplar = [
        ['İstenen Rol', 'app_role'],
        ['Başvuru Nedeni', 'app_reason'],
        ['Neden Hak Ediyorsun?', 'app_deserve'],
        ['Aktiflik', 'app_activity'],
        ['Ek Bilgi', 'app_extra']
      ];

      const embed = new EmbedBuilder()
        .setColor(0x8B5CF6)
        .setTitle('🌟 XRX | Yeni Özel Rol Başvurusu')
        .setDescription(`**Başvuran:** ${interaction.user} (\`${interaction.user.id}\`)`)
        .addFields(
          ...cevaplar.map(([label, id]) => ({
            name: label,
            value: interaction.fields.getTextInputValue(id) || 'Belirtilmedi',
            inline: false
          })),
          { name: 'Durum', value: '🟡 İnceleme bekliyor' }
        )
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: 'XRX SYSTEM • Başvuru Sistemi' })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`xrx_app_approve_${interaction.user.id}`)
          .setLabel('Onayla')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`xrx_app_reject_${interaction.user.id}`)
          .setLabel('Reddet')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`xrx_app_review_${interaction.user.id}`)
          .setLabel('İnceleniyor')
          .setEmoji('🔎')
          .setStyle(ButtonStyle.Secondary)
      );

      await channel.send({
        embeds: [embed],
        components: [row]
      });

      return interaction.reply({
        content: '✅ Başvurun başarıyla gönderildi!',
        ephemeral: true
      });
    }

    // Owner başvuru işlemleri
    if (
      interaction.isButton() &&
      interaction.customId.startsWith('xrx_app_') &&
      interaction.customId !== 'xrx_app_start'
    ) {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (!member.roles.cache.has(APP_OWNER_ROLE_ID)) {
        return interaction.reply({
          content: '❌ Bu işlemi yalnızca Owner yetkilileri yapabilir.',
          ephemeral: true
        });
      }

      const parts = interaction.customId.split('_');
      const action = parts[2];
      const applicantId = parts[3];

      const applicant = await client.users.fetch(applicantId).catch(() => null);

      if (!applicant) {
        return interaction.reply({
          content: '❌ Başvuru sahibi bulunamadı.',
          ephemeral: true
        });
      }

      const embed = EmbedBuilder.from(interaction.message.embeds[0]);
      const fields = embed.data.fields || [];

      let status;
      let dm;

      if (action === 'approve') {
        status = '✅ Başvuru onaylandı';
        dm = '🎉 Başvurun kabul edildi! Rolünü teslim almak için bir Owner ile iletişime geç.';
      } else if (action === 'reject') {
        status = '❌ Başvurun reddedildi.';
        dm = '❌ XRX özel rol başvurun maalesef reddedildi.';
      } else if (action === 'review') {
        status = '🔎 Başvurun inceleniyor';
        dm = '🔎 XRX özel rol başvurun inceleniyor. Sonuçlandığında sana tekrar mesaj gönderilecek.';
      } else {
        return;
      }

      embed.setFields(
        ...fields.filter(field => field.name !== 'Durum'),
        { name: 'Durum', value: status },
        { name: 'İşlemi Yapan', value: `${interaction.user}` }
      );

      const disabledRow = new ActionRowBuilder().addComponents(
        ...interaction.message.components[0].components.map(button => {
          const isReviewButton = button.customId.startsWith('xrx_app_review_');
          const disableAll = action === 'approve' || action === 'reject';

          return ButtonBuilder.from(button).setDisabled(
            disableAll || (action === 'review' && isReviewButton)
          );
        })
      );

      await interaction.update({
        embeds: [embed],
        components: [disabledRow]
      });

      await applicant.send(dm).catch(() => null);
    }
  } catch (error) {
    console.error('XRX Başvuru Sistemi Hatası:', error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ Bir hata oluştu. Bot konsolunu kontrol edin.',
        ephemeral: true
      }).catch(() => {});
    }
  }
});
client.once('ready', () => {
    console.log('XRX DND aktif!');
    client.user.setPresence({
        status: 'dnd'
    });
});
client.login(process.env.DISCORD_TOKEN);

client.once('clientReady', () => {
    client.user.setStatus('dnd');

    client.user.setPresence({
        status: 'dnd',
        activities: client.user.presence?.activities || []
    });

    baslatMacTakibi(client);
});
