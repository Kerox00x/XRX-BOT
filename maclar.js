
const fs = require('node:fs');
const path = require('node:path');

const MAC_KANAL_ID = '1570823891818123496';
const API_KEY = process.env.API_FOOTBALL_KEY;
const STATE_FILE = path.join(__dirname, 'maclar_durum.json');

const DURUMDAKI_MACLAR = new Set([
    '1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT'
]);

const BITEN_MACLAR = new Set(['FT', 'AET', 'PEN']);

let takimlar = [];
let fiksturler = [];
let sonFiksturGuncelleme = 0;
let sonCanliKontrol = 0;
let kontrolEdiliyor = false;
let clientRef;

let kayitlar = {};

try {
    if (fs.existsSync(STATE_FILE)) {
        kayitlar = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
} catch {
    kayitlar = {};
}

function kaydet() {
    fs.writeFileSync(STATE_FILE, JSON.stringify(kayitlar, null, 2));
}

async function apiGet(endpoint) {
    const response = await fetch(
        `https://v3.football.api-sports.io/${endpoint}`,
        {
            headers: {
                'x-apisports-key': API_KEY
            }
        }
    );

    if (!response.ok) {
        throw new Error(`API hatası: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors && Object.keys(data.errors).length > 0) {
        throw new Error(JSON.stringify(data.errors));
    }

    return data.response || [];
}

async function mesajGonder(mesaj) {
    try {
        const kanal = await clientRef.channels.fetch(MAC_KANAL_ID);

        if (kanal && kanal.isTextBased()) {
            await kanal.send(mesaj);
        }
    } catch (error) {
        console.error('Maç bildirimi gönderilemedi:', error.message);
    }
}

async function takimBul(arama, isimKontrolu) {
    const sonuc = await apiGet(
        `teams?search=${encodeURIComponent(arama)}`
    );

    const bulunan = sonuc.find(x =>
        isimKontrolu(
            x.team.name.toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
        )
    );

    if (!bulunan) {
        throw new Error(`${arama} takımı bulunamadı.`);
    }

    return {
        id: bulunan.team.id,
        name: bulunan.team.name
    };
}


async function fiksturleriGuncelle() {
    const bugun = new Date();
    const bitis = new Date();

    bitis.setDate(bitis.getDate() + 7);

    const from = bugun.toISOString().slice(0, 10);
    const to = bitis.toISOString().slice(0, 10);

    const yeniFiksturler = [];

    for (const takim of takimlar) {
        const sonuc = await apiGet(
       `fixtures?team=${takim.id}&season=2024&from=${from}&to=${to}`
        );

        yeniFiksturler.push(...sonuc);
    }

    fiksturler = yeniFiksturler;
    sonFiksturGuncelleme = Date.now();

    console.log('XRX maç fikstürleri güncellendi.');
}


function macTakipEdilmeli() {
    const simdi = Date.now();

    const yaklasanMac = fiksturler.some(mac => {
        const baslangic = new Date(mac.fixture.date).getTime();

        return baslangic >= simdi - 20 * 60 * 1000 &&
            baslangic <= simdi + 3 * 60 * 60 * 1000;
    });

    const devamEdenMac = Object.values(kayitlar).some(
        mac => mac.basladi && !mac.bitti
    );

    return yaklasanMac || devamEdenMac;
}

async function macIsle(mac) {
    const id = String(mac.fixture.id);
    const evSahibi = mac.teams.home.name;
    const deplasman = mac.teams.away.name;
    const evSkor = mac.goals.home ?? 0;
    const depSkor = mac.goals.away ?? 0;
    const durum = mac.fixture.status.short;

    let onceki = kayitlar[id];

    if (!onceki) {
        kayitlar[id] = {
            evSahibi,
            deplasman,
            evSkor,
            depSkor,
            basladi: true,
            bitti: false
        };

        kaydet();

        await mesajGonder(
            `⚽ **MAÇ BAŞLADI!**\n` +
            `🏟️ ${evSahibi} - ${deplasman}\n` +
            `📊 Skor: ${evSkor} - ${depSkor}`
        );

        return;
    }

    if (evSkor > onceki.evSkor || depSkor > onceki.depSkor) {
        let golAtan;

        if (evSkor > onceki.evSkor && depSkor > onceki.depSkor) {
            golAtan = 'İki takım da gol attı!';
        } else if (evSkor > onceki.evSkor) {
            golAtan = `⚽ GOL! ${evSahibi}`;
        } else {
            golAtan = `⚽ GOL! ${deplasman}`;
        }

        await mesajGonder(
            `🚨 **${golAtan}**\n` +
            `🏟️ ${evSahibi} - ${deplasman}\n` +
            `📊 Yeni skor: **${evSkor} - ${depSkor}**`
        );
    }

    onceki.evSkor = evSkor;
    onceki.depSkor = depSkor;
    onceki.basladi = true;

    if (BITEN_MACLAR.has(durum) && !onceki.bitti) {
        onceki.bitti = true;

        await mesajGonder(
            `🏁 **MAÇ SONA ERDİ!**\n` +
            `🏟️ ${evSahibi} - ${deplasman}\n` +
            `🏆 Final skoru: **${evSkor} - ${depSkor}**`
        );
    }

    kaydet();
}

async function canliMaclariKontrolEt() {
    if (kontrolEdiliyor) return;

    kontrolEdiliyor = true;

    try {
        const canliMaclar = await apiGet('fixtures?live=all');

        const takipEdilenIdler = takimlar.map(t => t.id);

        const bizimMaclar = canliMaclar.filter(mac =>
            takipEdilenIdler.includes(mac.teams.home.id) ||
            takipEdilenIdler.includes(mac.teams.away.id)
        );

        const gorulenMaclar = new Set();

        for (const mac of bizimMaclar) {
            gorulenMaclar.add(String(mac.fixture.id));
            await macIsle(mac);
        }

        // Canlı listeden kaybolan maçların bitip bitmediğini kontrol et.
        for (const [id, onceki] of Object.entries(kayitlar)) {
            if (
                onceki.basladi &&
                !onceki.bitti &&
                !gorulenMaclar.has(id)
            ) {
                const sonuc = await apiGet(`fixtures?id=${id}`);

                if (sonuc.length > 0) {
                    await macIsle(sonuc[0]);
                }
            }
        }

    } catch (error) {
        console.error('XRX maç kontrol hatası:', error.message);
    } finally {
        kontrolEdiliyor = false;
    }
}

async function baslatMacTakibi(client) {
    if (clientRef) return;

    clientRef = client;

    if (!API_KEY) {
        console.error('API_FOOTBALL_KEY .env dosyasında bulunamadı!');
        return;
    }

    try {
        console.log('XRX maç takip sistemi başlatılıyor...');

        const [turkiye, fenerbahce] = await Promise.all([
            takimBul('Turkey', isim =>
                isim === 'turkey' || isim === 'turkiye'
            ),
            takimBul('Fenerbahce', isim =>
                isim.includes('fenerbahce')
            )
        ]);

        takimlar = [turkiye, fenerbahce];

        console.log(
            `Takip edilen takımlar: ${turkiye.name}, ${fenerbahce.name}`
        );

        await fiksturleriGuncelle();
        await canliMaclariKontrolEt();

        setInterval(async () => {
            try {
                if (Date.now() - sonFiksturGuncelleme >= 12 * 60 * 60 * 1000) {
                    await fiksturleriGuncelle();
                }

                if (
                    macTakipEdilmeli() &&
                    Date.now() - sonCanliKontrol >= 3 * 60 * 1000
                ) {
                    sonCanliKontrol = Date.now();
                    await canliMaclariKontrolEt();
                }
            } catch (error) {
                console.error('Maç takip zamanlayıcısı:', error.message);
            }
        }, 60 * 1000);

        console.log('XRX maç takip sistemi aktif!');

    } catch (error) {
        console.error('Maç takip sistemi başlatılamadı:', error.message);
    }
}

module.exports = { baslatMacTakibi };
