const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const qs = require('querystring');

const app = express();

const izinVerilenSiteler = ['https://voluble-druid-b43db7.netlify.app']; 

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || izinVerilenSiteler.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('CORS Kalkanı: Bu API sadece Aktur Park uygulamasına hizmet verir!'));
        }
    }
}));

}
  }
}));

// UPTIMEROBOT HIZLI KONTROL KAPISI
app.get('/ping', (req, res) => {
    res.status(200).send('PONG - SUNUCU UYANIK');
});

const GIZLI_API_SIFRESI = process.env.API_KEY || "AKTUR_GIZLI_SIFRE_2026";

app.use((req, res, next) => {
    const gelenSifre = req.query.apiKey || req.headers['x-api-key'];
    if (gelenSifre !== GIZLI_API_SIFRESI) {
        return res.status(401).json({ hata: "Yetkisiz Erişim! Geçersiz API Anahtarı." });
    }
    next();
});

const username = process.env.OPIS_USER || "akturai";
const password = process.env.OPIS_PASS || "akturai1453";

// 🕒 GECE 00:00 - 03:00 ARASI ÇİFT TARİH HESAPLAYAN MOTOR
function getTarihler() {
    const today = new Date();
    const trTime = new Date(today.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
    const saat = trTime.getHours();
    
    // Eğer saat gece 00:00 ile 02:59 arasındaysa (UTC 00:00'a kadar)
    if (saat >= 0 && saat < 3) {
        let dun = new Date(trTime);
        dun.setDate(dun.getDate() - 1);
        
        const ayDun = String(dun.getMonth() + 1).padStart(2, '0');
        const gunDun = String(dun.getDate()).padStart(2, '0');
        const yilDun = dun.getFullYear();
        
        const ayBugun = String(trTime.getMonth() + 1).padStart(2, '0');
        const gunBugun = String(trTime.getDate()).padStart(2, '0');
        const yilBugun = trTime.getFullYear();

        return { 
            asilTarih: `${ayDun}/${gunDun}/${yilDun}`, 
            devirTarihi: `${ayBugun}/${gunBugun}/${yilBugun}`, 
            isDevirVakti: true 
        };
    } else {
        const ay = String(trTime.getMonth() + 1).padStart(2, '0');
        const gun = String(trTime.getDate()).padStart(2, '0');
        const yil = trTime.getFullYear();
        return { 
            asilTarih: `${ay}/${gun}/${yil}`, 
            devirTarihi: null, 
            isDevirVakti: false 
        };
    }
}

const SUNUCULAR_HASILAT = [
    { url: "http://213.74.17.67:8891/opis200", port: 8891 },
    { url: "http://213.74.17.67:8892/opis200", port: 8892 },
    { url: "http://213.74.17.67:8893/opis200", port: 8893 },
    { url: "http://213.74.17.67:8895/opis200", port: 8895 } 
];

async function opisHasilatSorgula(sunucu, sorguTarihi) {
    console.log(`[HASILAT] Kasa: ${sunucu.port} taranıyor. Tarih: ${sorguTarihi}`);
    const axiosInstance = axios.create({ timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    let cookies = [];
    let kasaCiroListesi = [];

    try {
        let res = await axiosInstance.get(`${sunucu.url}/login.jsf`);
        if (res.headers['set-cookie']) cookies = res.headers['set-cookie'].map(c => c.split(';')[0]);
        let $ = cheerio.load(res.data);
        let viewState = $('input[name="javax.faces.ViewState"]').val();

        let loginData = qs.stringify({ 'form': 'form', 'form:username': username, 'form:password': password, 'form:loginButton': '', 'javax.faces.ViewState': viewState });
        res = await axiosInstance.post(`${sunucu.url}/login.jsf`, loginData, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': cookies.join('; ') }, maxRedirects: 0, validateStatus: s => s >= 200 && s < 400 });
        if (res.headers['set-cookie']) cookies = [...new Set([...cookies, ...res.headers['set-cookie'].map(c => c.split(';')[0])])];

        res = await axiosInstance.get(`${sunucu.url}/reports/cashListReport.jsf`, { headers: { 'Cookie': cookies.join('; ') } });
        $ = cheerio.load(res.data);
        viewState = $('input[name="javax.faces.ViewState"]').val();

        if (!$('title').text().toLowerCase().includes('login')) {
            let dateInputs = [];
            $('input').each((i, el) => {
                let name = $(el).attr('name');
                if (name && name.includes('_input')) {
                    dateInputs.push(name);
                }
            });
            let baslangicInput = dateInputs[0] || 'form:j_idt18_input';
            let bitisInput = dateInputs[1] || 'form:j_idt20_input';
            
            let gosterBtn = $('button:contains("GÖSTER")').attr('name') || 'form:j_idt21';

            let reportDataH = qs.stringify({
                'javax.faces.partial.ajax': 'true',
                'javax.faces.source': gosterBtn,
                'javax.faces.partial.execute': '@all',
                'javax.faces.partial.render': 'form:cashTbl', 
                [gosterBtn]: gosterBtn,
                'form': 'form', 
                [baslangicInput]: sorguTarihi, 
                [bitisInput]: sorguTarihi, 
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

            let combinedHtml = "";
            const cdataRegex = /<!\[CDATA\[(.*?)\]\]>/gs;
            let match;
            while ((match = cdataRegex.exec(res.data)) !== null) {
                combinedHtml += match[1];
            }
            
            $ = cheerio.load(combinedHtml || res.data);

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
    try {
        let { asilTarih, devirTarihi, isDevirVakti } = getTarihler();
        let tumKasaVerileri = [];
        let devirKasaVerileri = [];
        
        // 1. Asıl günün cirosunu çek
        for (let sunucu of SUNUCULAR_HASILAT) {
            let sonuc = await opisHasilatSorgula(sunucu, asilTarih);
            tumKasaVerileri = tumKasaVerileri.concat(sonuc);
        }

        // 2. Eğer saat 00:00 ile 03:00 arasıysa, Devir (Sarkan) ciroyu da çek
        if (isDevirVakti) {
            for (let sunucu of SUNUCULAR_HASILAT) {
                let devirSonuc = await opisHasilatSorgula(sunucu, devirTarihi);
                devirKasaVerileri = devirKasaVerileri.concat(devirSonuc);
            }
        }

        let birlesikKasalar = {};
        let genelToplamCiro = 0;
        let devirToplamCiro = 0;

        for (let kasa of tumKasaVerileri) {
            if (!birlesikKasalar[kasa.isim]) {
                birlesikKasalar[kasa.isim] = 0;
            }
            birlesikKasalar[kasa.isim] += kasa.ciro;
            genelToplamCiro += kasa.ciro;
        }
        
        for (let devKasa of devirKasaVerileri) {
            devirToplamCiro += devKasa.ciro;
        }

        let kasaListesi = Object.keys(birlesikKasalar).map(isim => {
            return { isim: isim, ciro: birlesikKasalar[isim] };
        });
        kasaListesi.sort((a, b) => b.ciro - a.ciro);

        res.json({
            basarili: true,
            tarih: asilTarih,
            genelToplam: genelToplamCiro.toFixed(2),
            devirToplam: devirToplamCiro.toFixed(2),
            isDevirVakti: isDevirVakti,
            kasalar: kasaListesi.map(k => ({ isim: k.isim, ciro: k.ciro.toFixed(2) }))
        });

    } catch (error) {
        res.status(500).json({ hata: "Hasılat sunucusu yanıt vermedi." });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`[API AKTİF] Hasılat Motoru Dinleniyor...`));
