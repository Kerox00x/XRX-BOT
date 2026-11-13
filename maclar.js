
const fs = require('fs');
const path = require('path');

const MAC_KANAL_ID = '1570823891818123496';
const API_KEY = process.env.SPORTSTATS_KEY;
const API_URL = 'https://api.sportstatsapi.com/api/v1';

const DURUM_DOSYASI = path.join(__dirname, 'sportstats_maclar_durum.json');

let durumlar = {};
let kontrolDevamEdiyor = false;

try {
    if (fs.existsSync(DURUM_DOSYASI)) {
        durumlar = JSON.parse(fs.readFileSync(DURUM_DOSYASI, 'utf8'));
    }
} catch {
    durumlar = {};
}

function kaydet() {
    fs.writeFileSync(DURUM_DOSYASI, JSON.stringify(durumlar, null, 2));
}

function duzelt(metin) {
    return String(metin || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function hedefTakim(mac) {
    const ev = duzelt(mac.home_team?.name || mac.home_team?.display_name);
    const dep = duzelt(mac.away_team?.name || mac.away_team?.display_name);

    const takimlar = [ev, dep];

    for (const takim of takimlar) {
        if (
            ['turkey', 'turkiye', 'turkeynationalteam', 'turkiyenationalteam'].includes(takim)
        ) {
            return '🇹🇷 Türkiye';
        }

        if (
            takim.includes('fenerbahce') &&
            !/u\d+|women|kadin/.test(takim)
        ) {
            return '💛💙 Fenerbahçe';
        }
    }

    return null;
}

function macSkoru(mac) {
    const ev = mac.home_team?.score ?? '-';
    const dep = mac.away_team?.score ?? '-';

    return `${mac.home_team?.name || 'Ev sahibi'} ${ev} - ${dep} ${mac.away_team?.name || 'Deplasman'}`;
}

function macBittiMi(mac) {
    const kod = duzelt(mac.status_code);
    const durum = duzelt(mac.status);

    return ['ft', 'finished', 'fulltime', 'ended', 'completed', 'aet'].includes(kod) ||
           ['ft', 'finished', 'fulltime', 'ended', 'completed', 'aet'].includes(durum);
}

async function apiGet(endpoint) {
    const cevap = await fetch(`${API_URL}${endpoint}`, {
        headers: {
            Authorization: `Bearer ${API_KEY}`
        }
    });

    const json = await cevap.json();

    if (!cevap.ok || json.success !== true) {
        throw new Error(JSON.stringify(json.error || json.message || json));
    }

    return json.data;
}

async function mesajGonder(client, mesaj) {
    const kanal = await client.channels.fetch(MAC_KANAL_ID);

    if (!kanal) {
        throw new Error('Maç bildirim kanalı bulunamadı!');
    }

    await kanal.send(
        `${mesaj}\n\nVeri: [SportStatsAPI](https://sportstatsapi.com/)`
    );
}

async function macKontrol(client) {
    if (kontrolDevamEdiyor) return;
    kontrolDevamEdiyor = true;

    try {
        const canliMaclar = await apiGet('/soccer/matches/live');
        const gorulenler = new Set();

        for (const mac of canliMaclar) {
            const hedef = hedefTakim(mac);
            const id = String(mac.id || mac.match_id || '');

            if (!hedef || !id) continue;

            gorulenler.add(id);

            if (!durumlar[id]) {
                durumlar[id] = {
                    hedef,
                    basladi: false,
                    bitti: false
                };
            }

            const kayit = durumlar[id];

            if (macBittiMi(mac)) {
                if (!kayit.bitti) {
                    await mesajGonder(
                        client,
                        `🏁 **MAÇ SONA ERDİ!**\n${hedef}\n⚽ ${macSkoru(mac)}`
                    );

                    kayit.bitti = true;
                }
            } else if (!kayit.basladi) {
                await mesajGonder(
                    client,
                    `⚽ **MAÇ BAŞLADI!**\n${hedef}\n🏟️ ${macSkoru(mac)}`
                );

                kayit.basladi = true;
            }

            kaydet();
        }

        // Önceden canlı olan ama artık canlı listesinde bulunmayan maçların
        // bitip bitmediğini kontrol et.
        for (const [id, kayit] of Object.entries(durumlar)) {
            if (!kayit.basladi || kayit.bitti || gorulenler.has(id)) {
                continue;
            }

            try {
                const mac = await apiGet(`/soccer/matches/${id}`);

                if (macBittiMi(mac)) {
                    await mesajGonder(
                        client,
                        `🏁 **MAÇ SONA ERDİ!**\n${kayit.hedef}\n⚽ ${macSkoru(mac)}`
                    );

                    kayit.bitti = true;
                    kaydet();
                }
            } catch (hata) {
                console.log(`Maç sonucu kontrol edilemedi (${id}):`, hata.message);
            }
        }

        console.log('XRX maç kontrolü tamamlandı.');
    } catch (hata) {
        console.log('XRX maç takip hatası:', hata.message);
    } finally {
        kontrolDevamEdiyor = false;
    }
}

function baslatMacTakibi(client) {
    if (!API_KEY) {
        console.log('SPORTSTATS_KEY .env dosyasında bulunamadı!');
        return;
    }

    console.log('XRX maç takip sistemi başlatılıyor...');
    console.log('Takip edilenler: Türkiye ve Fenerbahçe');

    macKontrol(client);
    setInterval(() => macKontrol(client), 20 * 60 * 1000);
}

module.exports = { baslatMacTakibi };
