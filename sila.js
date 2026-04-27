const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    Browsers,
    DisconnectReason,
    jidDecode,
    downloadContentFromMessage,
    getContentType,
    makeInMemoryStore
} = require('@whiskeysockets/baileys');

const config = require('./config');
const { sms } = require('./lib/msg');
const { 
    connectdb,
    saveSessionToMongoDB,
    getSessionFromMongoDB,
    deleteSessionFromMongoDB,
    getUserConfigFromMongoDB,
    updateUserConfigInMongoDB,
    addNumberToMongoDB,
    removeNumberFromMongoDB,
    getAllNumbersFromMongoDB,
    saveOTPToMongoDB,
    verifyOTPFromMongoDB,
    incrementStats,
    getStatsForNumber
} = require('./lib/database');

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const axios = require('axios');
const moment = require('moment-timezone');

const router = express.Router();

// ==============================================================================
// INITIALIZATION & DATABASE
// ==============================================================================

connectdb();

// Stockage en mémoire
const activeSockets = new Map();
const socketCreationTime = new Map();
const store = makeInMemoryStore({ 
    logger: pino().child({ level: 'silent', stream: 'store' }) 
});

// Fonctions utilitaires
const getGroupAdmins = (participants) => {
    let admins = [];
    for (let i of participants) {
        if (i.admin == null) continue;
        admins.push(i.id);
    }
    return admins;
};

// ==============================================================================
// MAIN STARTBOT FUNCTION
// ==============================================================================

async function startBot(number, res = null) {
    let connectionLockKey;
    const sanitizedNumber = number.replace(/[^0-9]/g, '');

    try {
        const sessionDir = path.join(__dirname, 'session', `session_${sanitizedNumber}`);

        // Vérifier si déjà connecté
        if (activeSockets.has(sanitizedNumber)) {
            console.log(`⏩ ${sanitizedNumber} is already connected`);
            const creationTime = socketCreationTime.get(sanitizedNumber);
            const uptime = Math.floor((Date.now() - creationTime) / 1000);
            
            if (res && !res.headersSent) {
                return res.json({ 
                    status: 'already_connected', 
                    message: 'Number is already connected and active',
                    uptime: `${uptime} seconds`
                });
            }
            return;
        }

        // Verrou pour éviter connexions simultanées
        connectionLockKey = `connecting_${sanitizedNumber}`;
        if (global[connectionLockKey]) {
            console.log(`⏩ ${sanitizedNumber} is already in connection process`);
            if (res && !res.headersSent) {
                return res.json({ 
                    status: 'connection_in_progress', 
                    message: 'Number is currently being connected'
                });
            }
            return;
        }
        global[connectionLockKey] = true;

        // Vérifier session MongoDB
        const existingSession = await getSessionFromMongoDB(sanitizedNumber);

        if (!existingSession) {
            console.log(`🧹 No MongoDB session found for ${sanitizedNumber} - requiring NEW pairing`);
            if (fs.existsSync(sessionDir)) {
                await fs.remove(sessionDir);
            }
        } else {
            fs.ensureDirSync(sessionDir);
            fs.writeFileSync(path.join(sessionDir, 'creds.json'), JSON.stringify(existingSession, null, 2));
            console.log(`🔄 Restored existing session from MongoDB for ${sanitizedNumber}`);
        }

        // Initialiser socket
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const conn = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
            },
            printQRInTerminal: false,
            usePairingCode: !existingSession,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Safari'),
            syncFullHistory: false,
            getMessage: async (key) => {
                if (store) {
                    const msg = await store.loadMessage(key.remoteJid, key.id);
                    return msg?.message || undefined;
                }
                return { conversation: 'Hello' };
            }
        });

        // Enregistrer connexion
        socketCreationTime.set(sanitizedNumber, Date.now());
        activeSockets.set(sanitizedNumber, conn);
        store.bind(conn.ev);

        // Utility functions
        conn.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {};
                return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
            } else return jid;
        };

        // Pairing code generation
        if (!existingSession) {
            setTimeout(async () => {
                try {
                    await delay(1500);
                    const code = await conn.requestPairingCode(sanitizedNumber);
                    console.log(`🔑 Pairing Code: ${code}`);
                    if (res && !res.headersSent) {
                        return res.json({ 
                            code: code, 
                            status: 'new_pairing',
                            message: 'New pairing required'
                        });
                    }
                } catch (err) {
                    console.error('❌ Pairing Error:', err.message);
                    if (res && !res.headersSent) {
                        return res.json({ 
                            error: 'Failed to generate pairing code',
                            details: err.message 
                        });
                    }
                }
            }, 3000);
        } else if (res && !res.headersSent) {
            res.json({
                status: 'reconnecting',
                message: 'Attempting to reconnect with existing session data'
            });
        }

        // Sauvegarde session dans MongoDB
        conn.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf8');
            const creds = JSON.parse(fileContent);
            await saveSessionToMongoDB(sanitizedNumber, creds);
            console.log(`💾 Session updated in MongoDB for ${sanitizedNumber}`);
        });

        // GESTION CONNEXION
        conn.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === 'open') {
                console.log(`✅ Connected: ${sanitizedNumber}`);
                
                await addNumberToMongoDB(sanitizedNumber);
                
                const userJid = jidNormalizedUser(conn.user.id);
                
                const connectText = `┏━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃   🤖 SILATRIX BOT ACTIVE 🤖   ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━┛

✅ Bot Status: Connected
📱 Number: +${sanitizedNumber}
🔧 Prefix: ${config.PREFIX}
⚡ Platform: ${config.PLATFORM}

🔹 AUTO FEATURES:
• Auto Typing: ${config.AUTO_TYPING ? '✅' : '❌'}
• Auto Record: ${config.AUTO_RECORD ? '✅' : '❌'}
• Auto View Status: ${config.AUTO_VIEW_STATUS ? '✅' : '❌'}
• Auto Like Status: ${config.AUTO_LIKE_STATUS ? '✅' : '❌'}
• Auto React: ${config.AUTO_REACT ? '✅' : '❌'}
• Anti Link: ${config.ANTLINK ? '✅' : '❌'}

┌───────────────
│  Support: wa.me/${config.OWNER_NUMBER}
│  Channel: ${config.CHANNEL_LINK || 'Coming Soon'}
└───────────────

> © Silatrix Bot - Powered by Sila Tech`;

                if (!existingSession) {
                    try {
                        await conn.sendMessage(userJid, { text: connectText });
                    } catch (error) {
                        console.log(`⚠️ Could not send welcome message: ${error.message}`);
                    }
                }
                
                console.log(`🎉 ${sanitizedNumber} successfully connected!`);
            }

            if (connection === 'close') {
                let reason = lastDisconnect?.error?.output?.statusCode;
                
                // Clean up
                activeSockets.delete(sanitizedNumber);
                socketCreationTime.delete(sanitizedNumber);
                
                if (reason === DisconnectReason.loggedOut || reason === 401) {
                    console.log(`❌ Session closed for ${sanitizedNumber}: Logged Out`);
                    await deleteSessionFromMongoDB(sanitizedNumber);
                    await removeNumberFromMongoDB(sanitizedNumber);
                } else {
                    // Attempt reconnect
                    console.log(`🔄 Connection lost for ${sanitizedNumber}, attempting reconnect...`);
                    setTimeout(async () => {
                        try {
                            const mockRes = { 
                                headersSent: false, 
                                json: () => {}, 
                                status: () => mockRes 
                            };
                            await startBot(sanitizedNumber, mockRes);
                        } catch (reconnectError) {
                            console.error(`❌ Reconnect failed:`, reconnectError);
                        }
                    }, 10000);
                }
            }
        });

        // MESSAGE HANDLER
        conn.ev.on('messages.upsert', async (msg) => {
            try {
                let mek = msg.messages[0];
                if (!mek.message) return;
                
                const userConfig = await getUserConfigFromMongoDB(number);
                
                // Normalize Message
                mek.message = (getContentType(mek.message) === 'ephemeralMessage') 
                    ? mek.message.ephemeralMessage.message 
                    : mek.message;

                if (mek.message.viewOnceMessageV2) {
                    mek.message = (getContentType(mek.message) === 'ephemeralMessage') 
                        ? mek.message.ephemeralMessage.message 
                        : mek.message;
                }

                // Auto Read
                if (userConfig.READ_MESSAGE === 'true') {
                    await conn.readMessages([mek.key]);
                }

                // Message Serialization
                const m = sms(conn, mek);
                const type = getContentType(mek.message);
                const from = mek.key.remoteJid;
                const body = (type === 'conversation') ? mek.message.conversation : (type === 'extendedTextMessage') ? mek.message.extendedTextMessage.text : '';
                const sender = mek.key.fromMe ? conn.user.id : (mek.key.participant || mek.key.remoteJid);
                const senderNumber = sender.split('@')[0];
                const botNumber = conn.user.id.split(':')[0];
                const pushname = mek.pushName || 'User';
                const isMe = botNumber.includes(senderNumber);
                const isOwner = config.OWNER_NUMBER.includes(senderNumber) || isMe;
                const isGroup = from.endsWith('@g.us');

                // Auto Presence
                if (userConfig.AUTO_TYPING === 'true') await conn.sendPresenceUpdate('composing', from);
                if (userConfig.AUTO_RECORDING === 'true') await conn.sendPresenceUpdate('recording', from);

                // Status Handling
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    if (userConfig.AUTO_VIEW_STATUS === "true") await conn.readMessages([mek.key]);
                    if (userConfig.AUTO_LIKE_STATUS === "true") {
                        const emojis = userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;
                        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                        await conn.sendMessage(mek.key.remoteJid, {
                            react: { text: randomEmoji, key: mek.key } 
                        }, { statusJidList: [mek.key.participant] });
                    }
                    return;
                }

                // Auto React
                if (config.AUTO_REACT && !mek.key.fromMe) {
                    const reactions = ['❤️', '🔥', '👍', '🎉', '😂'];
                    const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
                    try {
                        await conn.sendMessage(from, {
                            react: { text: randomReaction, key: mek.key }
                        });
                    } catch (e) {}
                }

                // Anti Link
                if (config.ANTLINK && isGroup && !mek.key.fromMe) {
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const urls = body.match(urlRegex);
                    if (urls && urls.length > 0) {
                        try {
                            await conn.sendMessage(from, { delete: mek.key });
                            await conn.sendMessage(from, { 
                                text: '⚠️ Links are not allowed here!' 
                            });
                        } catch (e) {}
                    }
                }

                // Commands
                if (body.startsWith(config.PREFIX)) {
                    await incrementStats(sanitizedNumber, 'commandsUsed');
                    
                    const args = body.slice(config.PREFIX.length).trim().split(/ +/);
                    const command = args.shift().toLowerCase();
                    const q = args.join(' ');
                    
                    // Simple commands
                    switch(command) {
                        case 'ping':
                            await conn.sendMessage(from, { text: '🏓 Pong!' }, { quoted: mek });
                            break;
                            
                        case 'menu':
                            const menuText = `🤖 *SILATRIX BOT MENU*

👑 *Owner:* +${config.OWNER_NUMBER}
🔧 *Prefix:* ${config.PREFIX}

📱 *General Commands:*
• ${config.PREFIX}ping - Check bot status
• ${config.PREFIX}menu - Show this menu
• ${config.PREFIX}info - Bot information
• ${config.PREFIX}owner - Contact owner

⚙️ *Group Commands:*
• ${config.PREFIX}antilink on/off - Toggle anti-link
• ${config.PREFIX}tagall - Tag all members

🎵 *Media Commands:*
• ${config.PREFIX}play <song> - Search & play music
• ${config.PREFIX}yt <url> - Download YouTube video

🛡️ *Security:*
• ${config.PREFIX}anticall on/off - Toggle anti-call

📊 *Stats:*
• ${config.PREFIX}stats - Bot statistics
• ${config.PREFIX}speed - Test bot speed

🔗 *Support:*
• Channel: ${config.CHANNEL_LINK || 'N/A'}
• Owner: wa.me/${config.OWNER_NUMBER}

> © Silatrix Bot v2.0`;
                            
                            await conn.sendMessage(from, { 
                                text: menuText 
                            }, { quoted: mek });
                            break;
                            
                        case 'info':
                            const info = `*🤖 Silatrix Bot Info*

• *Name:* ${config.BOT_NAME}
• *Prefix:* ${config.PREFIX}
• *Platform:* ${config.PLATFORM}
• *Auth Method:* ${config.AUTH_METHOD}

*Active Features:*
• Auto Typing: ${config.AUTO_TYPING ? '✅' : '❌'}
• Auto Record: ${config.AUTO_RECORD ? '✅' : '❌'}
• Auto View Status: ${config.AUTO_VIEW_STATUS ? '✅' : '❌'}
• Auto React: ${config.AUTO_REACT ? '✅' : '❌'}
• Anti Link: ${config.ANTLINK ? '✅' : '❌'}`;
                            await conn.sendMessage(from, { text: info }, { quoted: mek });
                            break;
                            
                        case 'owner':
                            await conn.sendMessage(from, { 
                                text: `👑 *Bot Owner:* +${config.OWNER_NUMBER}\n\nContact via WhatsApp: wa.me/${config.OWNER_NUMBER}` 
                            }, { quoted: mek });
                            break;
                            
                        case 'stats':
                            const stats = await getStatsForNumber(sanitizedNumber);
                            let statsText = '*📊 Bot Statistics*\n\n';
                            if (stats.length > 0) {
                                const today = stats[0];
                                statsText += `*Today:*\n`;
                                statsText += `• Commands: ${today.commandsUsed}\n`;
                                statsText += `• Messages: ${today.messagesReceived}\n\n`;
                            }
                            statsText += `*Active Sessions:* ${activeSockets.size}`;
                            await conn.sendMessage(from, { text: statsText }, { quoted: mek });
                            break;
                            
                        case 'speed':
                            const start = Date.now();
                            await conn.sendMessage(from, { text: '⚡ Testing speed...' });
                            const end = Date.now();
                            const speed = end - start;
                            await conn.sendMessage(from, { 
                                text: `⚡ *Speed Test Result:*\n\n${speed}ms\n\n${speed < 1000 ? '✅ Fast' : '⚠️ Slow'}` 
                            }, { quoted: mek });
                            break;
                    }
                }

                // Increment message stats
                await incrementStats(sanitizedNumber, 'messagesReceived');
                if (isGroup) {
                    await incrementStats(sanitizedNumber, 'groupsInteracted');
                }

            } catch (e) {
                console.error('Message handler error:', e);
            }
        });

        // ANTI-CALL
        conn.ev.on('call', async (calls) => {
            try {
                const userConfig = await getUserConfigFromMongoDB(number);
                if (userConfig.ANTI_CALL !== 'true') return;
                
                for (const call of calls) {
                    if (call.status !== 'offer') continue;
                    await conn.rejectCall(call.id, call.from);
                    await conn.sendMessage(call.from, { 
                        text: userConfig.REJECT_MSG || '🔒 Calls not allowed!' 
                    });
                }
            } catch (err) {}
        });

    } catch (err) {
        console.error('StartBot error:', err);
        if (res && !res.headersSent) {
            return res.json({ 
                error: 'Internal Server Error', 
                details: err.message 
            });
        }
    } finally {
        if (connectionLockKey) {
            global[connectionLockKey] = false;
        }
    }
}

// ==============================================================================
// API ROUTES
// ==============================================================================

router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'pair.html')));

router.get('/code', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.json({ error: 'Number required' });
    await startBot(number, res);
});

router.get('/status', async (req, res) => {
    const { number } = req.query;
    
    if (!number) {
        const activeConnections = Array.from(activeSockets.keys()).map(num => {
            const creationTime = socketCreationTime.get(num);
            const uptime = Math.floor((Date.now() - creationTime) / 1000);
            return {
                number: num,
                status: 'connected',
                uptime: `${uptime} seconds`
            };
        });
        
        return res.json({
            totalActive: activeSockets.size,
            connections: activeConnections
        });
    }
    
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const isConnected = activeSockets.has(sanitizedNumber);
    const creationTime = socketCreationTime.get(sanitizedNumber);
    
    res.json({
        number: sanitizedNumber,
        isConnected,
        uptime: creationTime ? `${Math.floor((Date.now() - creationTime) / 1000)} seconds` : 0
    });
});

router.get('/disconnect', async (req, res) => {
    const { number } = req.query;
    if (!number) return res.status(400).json({ error: 'Number required' });
    
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    
    if (!activeSockets.has(sanitizedNumber)) {
        return res.status(404).json({ error: 'Number not found' });
    }
    
    try {
        const socket = activeSockets.get(sanitizedNumber);
        await socket.ws.close();
        socket.ev.removeAllListeners();
        activeSockets.delete(sanitizedNumber);
        socketCreationTime.delete(sanitizedNumber);
        await removeNumberFromMongoDB(sanitizedNumber);
        await deleteSessionFromMongoDB(sanitizedNumber);
        
        console.log(`✅ Manually disconnected ${sanitizedNumber}`);
        res.json({ status: 'success', message: 'Disconnected successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to disconnect' });
    }
});

router.get('/active', (req, res) => {
    res.json({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.json({
        status: 'active',
        message: 'Silatrix Bot is running',
        activeSessions: activeSockets.size,
        database: 'MongoDB Integrated'
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        const numbers = await getAllNumbersFromMongoDB();
        if (numbers.length === 0) {
            return res.status(404).json({ error: 'No numbers found' });
        }
        
        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }
            
            const mockRes = { headersSent: false, json: () => {}, status: () => mockRes };
            await startBot(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
            await delay(1000);
        }
        
        res.json({ status: 'success', total: numbers.length, connections: results });
    } catch (error) {
        res.status(500).json({ error: 'Failed to connect all bots' });
    }
});

// ==============================================================================
// AUTO RECONNECT
// ==============================================================================

async function autoReconnectFromMongoDB() {
    try {
        console.log('🔁 Auto-reconnecting from MongoDB...');
        const numbers = await getAllNumbersFromMongoDB();
        
        if (numbers.length === 0) {
            console.log('ℹ️ No numbers found for auto-reconnect');
            return;
        }
        
        console.log(`📊 Found ${numbers.length} numbers in MongoDB`);
        
        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                console.log(`🔁 Reconnecting: ${number}`);
                const mockRes = { headersSent: false, json: () => {}, status: () => mockRes };
                await startBot(number, mockRes);
                await delay(2000);
            }
        }
        
        console.log('✅ Auto-reconnect completed');
    } catch (error) {
        console.error('❌ Auto-reconnect error:', error.message);
    }
}

// Start auto-reconnect after 3 seconds
setTimeout(() => {
    autoReconnectFromMongoDB();
}, 3000);

// ==============================================================================
// TELEGRAM BOT (Optional)
// ==============================================================================

if (config.TELEGRAM_BOT_TOKEN) {
    const { Telegraf, Markup } = require('telegraf');
    const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
    
    bot.start((ctx) => {
        ctx.reply(`🤖 *SILATRIX BOT PAIRING SYSTEM*\n\nUse /pair <number> to pair your bot\nExample: /pair 255789661031`, { parse_mode: 'Markdown' });
    });
    
    bot.command('pair', async (ctx) => {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            return ctx.reply('❌ Usage: /pair <number>');
        }
        
        const number = args[1];
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        ctx.reply(`⏳ Pairing in progress...\nNumber: +${sanitizedNumber}`);
        
        const mockRes = {
            headersSent: false,
            json: (data) => {
                if (data.code) {
                    ctx.reply(`✅ *PAIRING CODE*\n\nCode: *${data.code}*\n\nValid for 20 seconds!`, { parse_mode: 'Markdown' });
                } else if (data.error) {
                    ctx.reply(`❌ Error: ${data.error}`);
                }
            },
            status: () => mockRes
        };
        
        await startBot(sanitizedNumber, mockRes);
    });
    
    bot.launch().then(() => {
        console.log('🤖 Telegram bot started!');
    }).catch(error => {
        console.error('❌ Telegram bot failed:', error);
    });
}

// ==============================================================================
// CLEANUP
// ==============================================================================

process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
    });
});

module.exports = router;
