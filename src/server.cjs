// mesajlaşma için server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Allowed origins can be overridden with the ALLOWED_ORIGINS env var
// (comma-separated) so you don't have to redeploy to change them.
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [
        "https://web.stapleapp.com",
        "https://socket.stapleapp.com"
    ];

const io = new Server(server, {
    path: "/socket.io",
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

// ==================== SESLİ KANAL DOLULUK (PRESENCE) ====================
// Sesli oda id'si `${serverId}:${channelId}`. Bir sunucunun tüm sesli
// kanallarındaki kullanıcıları, o sunucuyu izleyen (presence room) herkese
// yayınlarız — böylece kanala girmeden kimin içeride olduğu görülebilir.
const presenceRoom = (serverId) => `presence:${serverId}`;
const serverIdOf = (roomId) => (roomId ? roomId.split(':')[0] : null);

function buildVoiceState(serverId) {
    const state = {};
    const prefix = `${serverId}:`;
    for (const [roomId, members] of io.sockets.adapter.rooms) {
        if (!roomId.startsWith(prefix)) continue;
        const channelId = roomId.slice(prefix.length);
        const users = [];
        for (const sid of members) {
            const s = io.sockets.sockets.get(sid);
            if (!s || s.data.voiceRoom !== roomId) continue;
            users.push({
                socketId: sid,
                userId: s.data.userId,
                nickName: s.data.nickName,
                sharing: !!s.data.sharing,
                muted: !!s.data.muted,
                deafened: !!s.data.deafened,
            });
        }
        if (users.length) state[channelId] = users;
    }
    return state;
}

function broadcastVoiceState(serverId) {
    if (!serverId) return;
    io.to(presenceRoom(serverId)).emit('voice:state', {
        serverId,
        state: buildVoiceState(serverId),
    });
}

// ==================== KULLANICI ÇEVRİMİÇİ DURUMU (GLOBAL PRESENCE) ====================
// Uygulama açıkken her istemci socket bağlantısını açık tutar ve kimliğini
// bildirir. Bir kullanıcının HİÇ socket'i kalmayınca çevrimdışı sayılır.
// userId -> Set<socketId>
const onlineUsers = new Map();
// userId -> durum tercihi ("online" | "sleeping" | "dnd" | "offline"/görünmez)
const userStatus = new Map();
const USERS_ROOM = 'presence:users'; // güncellemeleri dinleyen istemciler

function presenceSnapshot() {
    return Array.from(onlineUsers.keys()).map((userId) => ({
        userId,
        status: userStatus.get(userId) || 'online',
    }));
}

function addOnline(userId, socketId) {
    let set = onlineUsers.get(userId);
    const wasOffline = !set || set.size === 0;
    if (!set) { set = new Set(); onlineUsers.set(userId, set); }
    set.add(socketId);
    return wasOffline; // ilk bağlantıysa true → "çevrimiçi oldu" yayını
}

function removeOnline(userId, socketId) {
    const set = onlineUsers.get(userId);
    if (!set) return false;
    set.delete(socketId);
    if (set.size === 0) { onlineUsers.delete(userId); return true; } // son bağlantı koptu
    return false;
}

// ==================== SENKRON YOUTUBE DİNLEME PARTİSİ ====================
// Müzik durumu, sesli oda (`${serverId}:${channelId}`) ile AYNI socket odasına
// bağlıdır → yalnızca o kanaldaki kişiler görür/kontrol eder. Sunucu otoriter
// state tutar. Saat kayması (clock skew) olmasın diye yayında ANLIK pozisyon +
// serverTs gönderilir; istemci yalnızca kendi yerel geçen süresiyle ekstrapole
// eder (getInviteInfo tarzı DEFINER değil; tamamen bellek içi, oda boşalınca silinir).
const musicRooms = new Map(); // roomId -> { current, queue[], playing, positionSec, updatedAt }

function freshMusic() {
    return { current: null, queue: [], playing: false, positionSec: 0, updatedAt: Date.now() };
}
function ensureMusic(roomId) {
    let m = musicRooms.get(roomId);
    if (!m) { m = freshMusic(); musicRooms.set(roomId, m); }
    return m;
}
function livePosition(m) {
    let pos = m.positionSec;
    if (m.playing && m.current) pos += (Date.now() - m.updatedAt) / 1000;
    return Math.max(0, pos);
}
function musicSnapshot(roomId) {
    const m = musicRooms.get(roomId) || freshMusic();
    return {
        current: m.current,
        queue: m.queue,
        playing: m.playing,
        positionSec: livePosition(m),
        serverTs: Date.now(),
    };
}
function broadcastMusic(roomId) {
    if (!roomId) return;
    io.to(roomId).emit('music:state', musicSnapshot(roomId));
}
function advanceMusic(m) {
    const nextItem = m.queue.shift() || null;
    m.current = nextItem;
    m.playing = !!nextItem;
    m.positionSec = 0;
    m.updatedAt = Date.now();
}
function voiceRoomHasMembers(roomId) {
    const set = io.sockets.adapter.rooms.get(roomId);
    if (!set) return false;
    for (const sid of set) {
        const s = io.sockets.sockets.get(sid);
        if (s && s.data.voiceRoom === roomId) return true;
    }
    return false;
}
function cleanupMusicIfEmpty(roomId) {
    if (roomId && !voiceRoomHasMembers(roomId)) musicRooms.delete(roomId);
}

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    // İstemci kimliğini (ve durum tercihini) bildirir → çevrimiçi kaydı + anlık liste
    socket.on('presence:online', ({ userId, status }) => {
        if (!userId) return;
        socket.data.presenceUserId = userId;
        socket.join(USERS_ROOM);
        if (status) userStatus.set(userId, status);
        const cameOnline = addOnline(userId, socket.id);
        // Yeni bağlanana tam liste (durum tercihleriyle)
        socket.emit('presence:snapshot', { users: presenceSnapshot() });
        // Diğerlerine yalnızca değişiklik
        if (cameOnline) {
            socket.to(USERS_ROOM).emit('presence:diff', {
                userId,
                online: true,
                status: userStatus.get(userId) || 'online',
            });
        }
    });

    // Durum tercihi değişti (online/sleeping/dnd/offline-görünmez) → herkese yay
    socket.on('presence:status', ({ status }) => {
        const userId = socket.data.presenceUserId;
        if (!userId || !status) return;
        userStatus.set(userId, status);
        io.to(USERS_ROOM).emit('presence:diff', { userId, online: true, status });
    });

    // Çıkış yaparken (logout) bağlantıyı kapatmadan çevrimdışı ol
    socket.on('presence:offline', () => {
        const userId = socket.data.presenceUserId;
        if (!userId) return;
        socket.data.presenceUserId = null;
        socket.leave(USERS_ROOM);
        if (removeOnline(userId, socket.id)) {
            userStatus.delete(userId);
            io.to(USERS_ROOM).emit('presence:diff', { userId, online: false });
        }
    });

    // Bir sunucunun sesli kanal doluluğunu izlemeye başla/bırak
    socket.on('voice:watch', ({ serverId }) => {
        if (!serverId) return;
        socket.join(presenceRoom(serverId));
        socket.emit('voice:state', { serverId, state: buildVoiceState(serverId) });
    });

    socket.on('voice:unwatch', ({ serverId }) => {
        if (serverId) socket.leave(presenceRoom(serverId));
    });

    // ==================== WebRTC SESLİ KANAL SIGNALING ====================
    // Sesli kanala katıl: odadaki mevcut peer'ları yeni gelene bildir,
    // diğerlerine de yeni peer'ı haber ver.
    socket.on('voice:join', ({ roomId, userId, nickName }) => {
        socket.data.voiceRoom = roomId;
        socket.data.userId = userId;
        socket.data.nickName = nickName;
        socket.data.muted = false;
        socket.data.deafened = false;
        socket.join(roomId);

        const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || [])
            .filter((id) => id !== socket.id);

        const peers = clients.map((id) => {
            const s = io.sockets.sockets.get(id);
            return {
                socketId: id,
                userId: s?.data?.userId,
                nickName: s?.data?.nickName,
                sharing: !!s?.data?.sharing,
                muted: !!s?.data?.muted,
                deafened: !!s?.data?.deafened,
            };
        });

        // Yeni gelene mevcut peer listesini gönder (o initiator olacak)
        socket.emit('voice:peers', peers);
        // Diğerlerine yeni katılanı bildir
        socket.to(roomId).emit('voice:peer-joined', {
            socketId: socket.id,
            userId,
            nickName,
        });
        broadcastVoiceState(serverIdOf(roomId));
        // Yeni gelene mevcut müzik partisi durumunu ilet
        if (musicRooms.has(roomId)) socket.emit('music:state', musicSnapshot(roomId));
        console.log(`voice:join ${nickName} -> ${roomId} (${peers.length} peer)`);
    });

    // Signaling mesajlarını hedef peer'a ilet
    socket.on('voice:offer', ({ to, sdp }) => {
        io.to(to).emit('voice:offer', {
            from: socket.id,
            sdp,
            userId: socket.data.userId,
            nickName: socket.data.nickName,
        });
    });

    socket.on('voice:answer', ({ to, sdp }) => {
        io.to(to).emit('voice:answer', { from: socket.id, sdp });
    });

    socket.on('voice:ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('voice:ice-candidate', { from: socket.id, candidate });
    });

    // Sustur/aç durumu — hem mesh'teki peer'lara (katılımcı listesi) hem
    // presence izleyicilerine (server sidebar) yayılır.
    socket.on('voice:mute', ({ muted }) => {
        socket.data.muted = !!muted;
        const roomId = socket.data.voiceRoom;
        if (roomId) {
            socket.to(roomId).emit('voice:peer-mute', {
                socketId: socket.id,
                muted: !!muted,
            });
            broadcastVoiceState(serverIdOf(roomId));
        }
    });

    // Sağırlaştır/aç durumu — mesh peer'larına + presence izleyicilerine yayılır.
    socket.on('voice:deafen', ({ deafened }) => {
        socket.data.deafened = !!deafened;
        const roomId = socket.data.voiceRoom;
        if (roomId) {
            socket.to(roomId).emit('voice:peer-deafen', {
                socketId: socket.id,
                deafened: !!deafened,
            });
            broadcastVoiceState(serverIdOf(roomId));
        }
    });

    // Sesli kanaldan ayrıl
    socket.on('voice:leave', () => {
        const roomId = socket.data.voiceRoom;
        if (roomId) {
            if (socket.data.sharing) {
                socket.to(roomId).emit('screen:stopped', { socketId: socket.id });
                socket.data.sharing = false;
            }
            socket.to(roomId).emit('voice:peer-left', { socketId: socket.id });
            socket.leave(roomId);
            socket.data.voiceRoom = null;
            broadcastVoiceState(serverIdOf(roomId));
            cleanupMusicIfEmpty(roomId);
        }
    });

    // ==================== YAZI KANALI "YAZIYOR..." ====================
    // Sohbet odasına katıl/ayrıl (ses mesh'inden bağımsız, ayrı room)
    socket.on('chat:join', ({ channelId }) => {
        if (channelId) socket.join(`chat:${channelId}`);
    });

    socket.on('chat:leave', ({ channelId }) => {
        if (channelId) socket.leave(`chat:${channelId}`);
    });

    // "yazıyor" durumunu odadaki diğerlerine ilet
    socket.on('chat:typing', ({ channelId, userId, nickName, isTyping }) => {
        if (!channelId) return;
        socket.to(`chat:${channelId}`).emit('chat:typing', { userId, nickName, isTyping });
    });

    // ==================== EKRAN PAYLAŞIMI SIGNALING ====================
    // Paylaşım başlat/durdur — odaya duyurulur
    socket.on('screen:start', () => {
        socket.data.sharing = true;
        if (socket.data.voiceRoom) {
            socket.to(socket.data.voiceRoom).emit('screen:started', {
                socketId: socket.id,
                userId: socket.data.userId,
                nickName: socket.data.nickName,
            });
            broadcastVoiceState(serverIdOf(socket.data.voiceRoom));
        }
    });

    socket.on('screen:stop', () => {
        socket.data.sharing = false;
        if (socket.data.voiceRoom) {
            socket.to(socket.data.voiceRoom).emit('screen:stopped', { socketId: socket.id });
            broadcastVoiceState(serverIdOf(socket.data.voiceRoom));
        }
    });

    // İzleme talebi/iptali — paylaşan kişiye iletilir
    socket.on('screen:watch', ({ to }) => {
        io.to(to).emit('screen:watch-request', { from: socket.id });
    });

    socket.on('screen:unwatch', ({ to }) => {
        io.to(to).emit('screen:unwatch-request', { from: socket.id });
    });

    // Ekran paylaşımı için ayrı WebRTC signaling (ses mesh'inden bağımsız)
    socket.on('screen:offer', ({ to, sdp }) => {
        io.to(to).emit('screen:offer', { from: socket.id, sdp });
    });

    socket.on('screen:answer', ({ to, sdp }) => {
        io.to(to).emit('screen:answer', { from: socket.id, sdp });
    });

    socket.on('screen:ice-candidate', ({ to, candidate }) => {
        io.to(to).emit('screen:ice-candidate', { from: socket.id, candidate });
    });
    // =====================================================================

    // ==================== YOUTUBE DİNLEME PARTİSİ ====================
    // Tüm olaylar socket.data.voiceRoom üzerinden çalışır → yalnızca o sesli
    // kanaldaki kişiler kontrol edebilir/görebilir.
    socket.on('music:request', () => {
        const roomId = socket.data.voiceRoom;
        if (roomId) socket.emit('music:state', musicSnapshot(roomId));
    });

    // Kuyruğa ekle; boşsa hemen çalmaya başla.
    socket.on('music:enqueue', ({ video }) => {
        const roomId = socket.data.voiceRoom;
        if (!roomId || !video || !video.id) return;
        const m = ensureMusic(roomId);
        const item = {
            id: String(video.id).slice(0, 20),
            title: video.title ? String(video.title).slice(0, 200) : '',
            addedBy: socket.data.nickName || '',
            addedById: socket.data.userId || null,
        };
        if (!m.current) {
            m.current = item; m.playing = true; m.positionSec = 0; m.updatedAt = Date.now();
        } else if (m.queue.length < 100) {
            m.queue.push(item);
        }
        broadcastMusic(roomId);
    });

    // Oynat / duraklat / ileri / sar / temizle
    socket.on('music:control', ({ action, positionSec }) => {
        const roomId = socket.data.voiceRoom;
        if (!roomId) return;
        const m = ensureMusic(roomId);
        switch (action) {
            case 'play':
                if (m.current) { m.playing = true; m.updatedAt = Date.now(); }
                break;
            case 'pause':
                m.positionSec = livePosition(m); m.playing = false; m.updatedAt = Date.now();
                break;
            case 'seek':
                m.positionSec = Math.max(0, Number(positionSec) || 0); m.updatedAt = Date.now();
                break;
            case 'next':
                advanceMusic(m);
                break;
            case 'clear':
                m.current = null; m.queue = []; m.playing = false; m.positionSec = 0; m.updatedAt = Date.now();
                break;
            default:
                return;
        }
        broadcastMusic(roomId);
    });

    // Kuyruktan sıradaki bir öğeyi kaldır
    socket.on('music:remove', ({ index }) => {
        const roomId = socket.data.voiceRoom;
        if (!roomId) return;
        const m = musicRooms.get(roomId);
        if (!m) return;
        if (Number.isInteger(index) && index >= 0 && index < m.queue.length) {
            m.queue.splice(index, 1);
            broadcastMusic(roomId);
        }
    });

    // Çözülen video başlığını yay (istemci player'dan okur; API anahtarı gerekmez)
    socket.on('music:title', ({ id, title }) => {
        const roomId = socket.data.voiceRoom;
        if (!roomId) return;
        const m = musicRooms.get(roomId);
        if (!m || !m.current) return;
        if (m.current.id === id && !m.current.title && title) {
            m.current.title = String(title).slice(0, 200);
            broadcastMusic(roomId);
        }
    });

    // Video bitince sıradakine geç. Çok istemci aynı anda bildirebilir →
    // yalnızca hâlâ çalan video için ilerlet (dedupe).
    socket.on('music:ended', ({ endedId }) => {
        const roomId = socket.data.voiceRoom;
        if (!roomId) return;
        const m = musicRooms.get(roomId);
        if (!m || !m.current) return;
        if (endedId && endedId !== m.current.id) return;
        advanceMusic(m);
        broadcastMusic(roomId);
    });
    // =====================================================================

    // Kullanıcı bağlantısı kesildiğinde
    socket.on('disconnect', () => {
        console.log('Bir kullanıcı ayrıldı:', socket.id);

        // Global presence: bu kullanıcının son socket'iyse çevrimdışı yayınla
        const presenceUserId = socket.data.presenceUserId;
        if (presenceUserId && removeOnline(presenceUserId, socket.id)) {
            userStatus.delete(presenceUserId);
            io.to(USERS_ROOM).emit('presence:diff', { userId: presenceUserId, online: false });
        }

        // Sesli kanaldaki peer'lara ayrıldığını bildir
        if (socket.data.voiceRoom) {
            if (socket.data.sharing) {
                socket.to(socket.data.voiceRoom).emit('screen:stopped', { socketId: socket.id });
            }
            socket.to(socket.data.voiceRoom).emit('voice:peer-left', { socketId: socket.id });
            // 'disconnect' anında socket odalardan çıkmış olur → state doğru hesaplanır
            broadcastVoiceState(serverIdOf(socket.data.voiceRoom));
            cleanupMusicIfEmpty(socket.data.voiceRoom);
        }
    });
});

server.on('error', (error) => {
    console.error('Sunucu hatası:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Yakalanmamış istisna:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('İşlenmeyen reddetme:', reason);
});

// Hosting platforms (Render, Fly, etc.) inject the port via process.env.PORT.
// Fall back to 3000 for local development.
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor ve tüm ağ arayüzlerinden erişilebilir`);
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});