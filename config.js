require('dotenv').config();

module.exports = {
    BOT_OWNER: process.env.BOT_OWNER || "255789661031@s.whatsapp.net",
    BOT_NAME: process.env.BOT_NAME || "Silatrix Bot",
    PREFIX: process.env.PREFIX || ".",
    SESSION_ID: process.env.SESSION_ID || "silatrix_pro_bot",
    PORT: process.env.PORT || 3000,
    PLATFORM: process.env.PLATFORM || 'unknown',
    AUTH_METHOD: process.env.AUTH_METHOD || 'pair',
    MONGODB_URI: process.env.MONGODB_URI,
    
    // Auto Features
    ALWAYS_ONLINE: process.env.ALWAYS_ONLINE === 'true',
    AUTO_TYPING: process.env.AUTO_TYPING === 'true',
    AUTO_RECORD: process.env.AUTO_RECORD === 'true',
    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS === 'true',
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS === 'true',
    AUTO_REACT: process.env.AUTO_REACT === 'true',
    AUTO_VIEW_STORY: process.env.AUTO_VIEW_STORY === 'true',
    ANTLINK: process.env.ANTLINK === 'true',
    AUTO_READ: process.env.AUTO_READ !== 'false',
    
    // Telegram
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    
    // Owner Number
    OWNER_NUMBER: process.env.BOT_OWNER ? process.env.BOT_OWNER.split('@')[0] : "255789661031",
    
    // Channel Links
    CHANNEL_LINK: process.env.CHANNEL_LINK || "https://whatsapp.com/channel/0029VbBG4gfISTkCpKxyMH02",
    
    // Group Links for Auto-Join
    GROUP_LINK_1: process.env.GROUP_LINK_1 || "https://chat.whatsapp.com/IdGNaKt80DEBqirc2ek4ks",
    GROUP_LINK_2: process.env.GROUP_LINK_2 || "https://i.ibb.co/xSWT97FL/file-0000000092e071f59295ba1ea89aa84b.png",
    
    // Channel JIDs for Auto-Follow
    CHANNEL_JID_1: process.env.CHANNEL_JID_1 || "120363402325089913@newsletter",
    CHANNEL_JID_2: process.env.CHANNEL_JID_2 || "120363421404091643@newsletter",
    
    // Work Type (public/private)
    WORK_TYPE: process.env.WORK_TYPE || "public",
    
    // Mode
    MODE: process.env.MODE || "public",
    
    // Auto Bio
    AUTO_BIO: process.env.AUTO_BIO || "false",
    BIO_LIST: [
        "🤖 Silatrix Bot | Always Active",
        "⚡ Powered by Sila Tech",
        "🌟 Your Ultimate WhatsApp Bot",
        "💫 Multi-Device Support"
    ],
    
    // Auto Like Emoji for Status
    AUTO_LIKE_EMOJI: ['❤️', '🔥', '👍', '🌟', '💫', '✨', '🎉', '💖'],
    
    // Auto Status Reply Message
    AUTO_STATUS_MSG: "👋 Hello! Silatrix Bot is watching your status! 🌟"
};
