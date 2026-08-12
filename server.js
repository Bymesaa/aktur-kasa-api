const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const qs = require('querystring');

const app = express();

// ==========================================
// 🛡️ 1. GÜVENLİK KALKANI: SADECE NETLIFY'A İZİN VER
// ==========================================
const izinVerilenSiteler = ['https://voluble-druid-b43db7.netlify.app/']; // BURAYI KENDİ NETLIFY ADRESİNLE DEĞİŞTİR

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || izinVerilenSiteler.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('CORS Kalkanı: Bu API sadece Aktur Park uygulamasına hizmet verir!'));
        }
    }
}));

// ==========================================
// 🛡️ 2. GÜVENLİK KALKANI: GİZLİ API ŞİFRESİ
// ==========================================
const GIZLI_API_SIFRESI = process.env.API_KEY || "AKTUR_GIZLI_SIFRE_2026";

app.use((req, res, next) => {
    const gelenSifre = req.query.apiKey || req.headers['x-api-key'];
    if (gelenSifre !== GIZLI_API_SIFRESI) {
        console.log(`[GÜVENLİK UYARISI] Yetkisiz erişim denemesi engellendi!`);
        return res.status(401).json({ hata: "Yetkisiz Erişim! Geçersiz API Anahtarı." });
    }
    next();
});

// ==========================================
// ⚙️ GENEL AYARLAR VE YARDIMCI FONKSİYONLAR
// ==========================================
const username = process.env.OPIS_USER || "akturai";
const password = process.env.OPIS_PASS || "akturai1453";

function getBugunKutu() {
    const today = new Date();
    const ay = String(today.getMonth() + 1).padStart(2, '0');
    const gun = String(today.getDate()).padStart(2, '0');
    const yil = today.getFullYear();
    return `${ay}/${gun}/${yil}`; // OPIS Amerikan Formatı (AA/GG/YYYY)
}

// ==============================================================================================
// 💵 HASILAT RAPORU SORGULAMA MOTORU (91, 92, 93, 95)
// ==============================================================================================
const SUNUCULAR_HASILAT = [
    { url: "http://213.74.17.67:8891/opis200", port: 8891 },
    { url: "http://213.74.17.67:8892/opis200", port: 8892 },
    { url: "http://213.74.17.67:8893/opis200", port: 8893 },
    { url: "http://213.74.17.67:8895/opis200", port: 8895 } 
];

async function opisHasilatSorgula(sunucu) {
    console.log(`[HASILAT] Kasa: ${sunucu.port} taranıyor...`);
    const axiosInstance = axios.create({ timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
    let cookies = [];
    let kasaCiroListesi = [];

    try {
        // 1. KASAYA GİRİŞ
        let res = await axiosInstance.get(`${sunucu.url}/login.jsf`);
        if (res.headers['set-cookie']) cookies = res.headers['set-cookie'].map(c => c.split(';')[0]);
        let $ = cheerio.load(res.data);
        let viewState = $('input[name="javax.faces.ViewState"]').val();

        let loginData = qs.stringify({ 'form': 'form', 'form:username': username, 'form:password': password, 'form:loginButton': '', 'javax.faces.ViewState': viewState });
        res = await axiosInstance.post(`${sunucu.url}/login.jsf`, loginData, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies.join('; ') }, maxRedirects: 0, validateStatus: s => s >= 200 && s < 400 });
        if (res.headers['set-cookie']) cookies = [...new Set([...cookies, ...res.headers['set-cookie'].map(c => c.split(';')[0])])];

        const bugunKutu = getBugunKutu();

        // 2. KASA RAPORUNA GİT
        res = await axiosInstance.get(`${sunucu.url}/reports/cashListReport.jsf`, { headers: { 'Cookie': cookies.join('; ') } });
        $ = cheerio.load(res.data);
        viewState = $('input[name="javax.faces.ViewState"]').val();

        if (!$('title').text().toLowerCase().includes('login')) {
            let baslangicInput = $('td:contains("Başlangıç Tarihi")').next('td').find('input').attr('name') || 'form:j_idt18_input';
            let bitisInput = $('td:contains("Bitiş Tarihi")').next('td').find('input').attr('name') || 'form:j_idt20_input';
            let gosterBtn = $('button:contains("GÖSTER")').attr('name') || 'form:j_idt21';

            let reportDataH = qs.stringify({
                'javax.faces.partial.ajax': 'true',
                'javax.faces.source': gosterBtn,
                'javax.faces.partial.execute': '@all',
                'javax.faces.partial.render': 'form:cashTbl', 
                [gosterBtn]: gosterBtn,
                'form': 'form', 
                [baslangicInput]: bugunKutu, 
                [bitisInput]: bugunKutu, 
                'javax.faces.ViewState': viewState
            });

            res = await axiosInstance.post(`${sunucu.url}/reports/cashListReport.jsf`, reportDataH, {
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Faces-Request': 'partial/ajax',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Cookie': cookies.join('; ') 
                }
            });

            let xmlData = res.data;
            let cdataMatch = xmlData.match(/<!\[CDATA\[(.*?)\]\]>/s);
            let tableHtml = cdataMatch ? cdataMatch[1] : xmlData;
            $ = cheerio.load(tableHtml);

            // 3. TABLODAN KASİYER (1. İndeks) ve TOPLAM CİRO (10. İndeks) VERİLERİNİ ÇEK
            $('tbody.ui-datatable-data tr').each((i, row) => {
                let cols = $(row).find('td');
                if (cols.length >= 11) { 
                    let kasiyerAdi = $(cols[1]).text().trim().toUpperCase();
                    let toplamCiro = parseFloat($(cols[10]).text().trim()) || 0;
                    
                    if (kasiyerAdi && kasiyerAdi !== "" && toplamCiro > 0) {
                        kasaCiroListesi.push({
                            isim: kasiyerAdi,
                            ciro: toplamCiro
                        });
                    }
                }
            });
        }
        return kasaCiroListesi;

    } catch (e) {
        console.log(`[HATA] ${sunucu.port} Hasılat Raporu Çekilemedi.`);
        return [];
    }
}

app.get('/api/hasilat-sorgula', async (req, res) => {
    console.log(`\n================================`);
    console.log(`[YENİ] HASILAT SORGUSU BAŞLATILDI`);

    try {
        let tumKasaVerileri = [];
        
        for (let sunucu of SUNUCULAR_HASILAT) {
            let sonuc = await opisHasilatSorgula(sunucu);
            tumKasaVerileri = tumKasaVerileri.concat(sonuc);
        }

        // AYNI İSİMLİ KASALARI BİRLEŞTİR
        let birlesikKasalar = {};
        let genelToplamCiro = 0;

        for (let kasa of tumKasaVerileri) {
            if (!birlesikKasalar[kasa.isim]) {
                birlesikKasalar[kasa.isim] = 0;
            }
            birlesikKasalar[kasa.isim] += kasa.ciro;
            genelToplamCiro += kasa.ciro;
        }

        // OBJEYİ DİZİYE ÇEVİR VE BÜYÜKTEN KÜÇÜĞE SIRALA
        let kasaListesi = Object.keys(birlesikKasalar).map(isim => {
            return { isim: isim, ciro: birlesikKasalar[isim] };
        });
        kasaListesi.sort((a, b) => b.ciro - a.ciro);

        res.json({
            basarili: true,
            tarih: getBugunKutu(),
            genelToplam: genelToplamCiro.toFixed(2),
            kasalar: kasaListesi.map(k => ({ isim: k.isim, ciro: k.ciro.toFixed(2) }))
        });

    } catch (error) {
        console.error(`[KRİTİK HATA] Hasılat Sunucu Hatası: ${error.message}`);
        res.status(500).json({ hata: "Hasılat sunucusu yanıt vermedi." });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`[API AKTİF] Hasılat Motoru Dinleniyor...`));
