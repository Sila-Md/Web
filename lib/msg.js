const { downloadContentFromMessage, getContentType } = require('@whiskeysockets/baileys');

const sms = (conn, m) => {
    if (!m.message) return m;
    
    let M = {};
    try {
        M = m.message;
        if (M.ephemeralMessage) {
            M = M.ephemeralMessage.message;
        }
        if (M.viewOnceMessageV2) {
            M = M.viewOnceMessageV2.message;
        }
    } catch (e) {
        M = m.message;
    }
    
    const type = getContentType(M) || '';
    
    m.type = type;
    m.text = '';
    
    if (type === 'conversation') {
        m.text = M.conversation || '';
    } else if (type === 'extendedTextMessage') {
        m.text = M.extendedTextMessage?.text || '';
    } else if (type === 'imageMessage') {
        m.text = M.imageMessage?.caption || '';
    } else if (type === 'videoMessage') {
        m.text = M.videoMessage?.caption || '';
    }
    
    m.quoted = {};
    if (M.extendedTextMessage?.contextInfo?.quotedMessage) {
        m.quoted = M.extendedTextMessage.contextInfo.quotedMessage;
    }
    
    return m;
};

module.exports = { sms };
