// server.js (Versão Final - Apenas Imagens)

// 1. Importar as bibliotecas necessárias
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const url = require('url');
const sharp = require('sharp');

// 2. Inicializar o aplicativo Express
const app = express();
const PORT = process.env.PORT || 3001;

// 3. Configurar o CORS
app.use(cors());

// --- Função de Scraping com Puppeteer (otimizada para imagens) ---
async function scrapeImagesWithPuppeteer(pageUrl) {
    console.log(`[DIAGNÓSTICO] Iniciando scraping de imagens com Puppeteer para: ${pageUrl}`);
    let browser = null;
    const foundImages = new Set(); 

    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Interceta os pedidos de rede para encontrar ficheiros de imagem
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const requestUrl = request.url();
            if (/\.(jpg|jpeg|png|gif|webp)$/i.test(requestUrl)) {
                foundImages.add(requestUrl);
            }
            request.continue();
        });

        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Adicionalmente, analisa o HTML final para encontrar tags <img>
        const content = await page.content();
        const $ = require('cheerio').load(content);
        $('img').each((i, el) => { 
            const src = $(el).attr('src') || $(el).attr('data-src');
            if (src) {
                // Ignora imagens muito pequenas ou base64
                if (!src.startsWith('data:')) {
                    foundImages.add(new url.URL(src, pageUrl).href);
                }
            }
        });

        await browser.close();
        console.log(`[DIAGNÓSTICO] Scraping com Puppeteer concluído. Encontradas ${foundImages.size} imagens.`);
        return Array.from(foundImages);

    } catch (error) {
        console.error(`[DIAGNÓSTICO] Erro durante o scraping com Puppeteer para ${pageUrl}:`, error.message);
        if (browser) await browser.close();
        return [];
    }
}


// 4. Endpoint da API (agora apenas para imagens)
app.get('/api/media', async (req, res) => {
  const sources = req.query.sources ? req.query.sources.split(',') : [];
  if (sources.length === 0) return res.json([]);

  let allMedia = [];
  let idCounter = 0;

  for (const source of sources) {
    try {
        const imageUrls = await scrapeImagesWithPuppeteer(source);
        for (const imageUrl of imageUrls) {
            allMedia.push({
                id: `scrape-${idCounter++}`,
                type: 'image',
                url: imageUrl,
                author: new url.URL(source).hostname,
                source: 'web',
                timestamp: new Date(),
            });
        }
    } catch (error) {
        console.log(`[DIAGNÓSTICO] Fonte "${source}" não é um URL válido para scraping, ignorando.`);
    }
  }
  res.json(allMedia);
});

// 5. Endpoint de Otimização de Imagens
app.get('/api/image-proxy', async (req, res) => {
    const { url: imageUrl, q: quality } = req.query;
    if (!imageUrl) return res.status(400).send('URL da imagem é obrigatória');

    try {
        const response = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');

        let transformer = sharp(imageBuffer);

        if (quality === 'low') {
            transformer = transformer.resize(20).blur(5).webp({ quality: 20 });
        } else {
            transformer = transformer.resize(1280, null, { withoutEnlargement: true }).webp({ quality: 80 });
        }

        const optimizedBuffer = await transformer.toBuffer();
        res.set('Content-Type', 'image/webp');
        res.send(optimizedBuffer);

    } catch (error) {
        res.status(500).send('Não foi possível processar a imagem.');
    }
});


// 6. Endpoint para fazer o proxy do download
app.get('/api/download', async (req, res) => {
  const { url: fileUrl } = req.query;
  if (!fileUrl) return res.status(400).send('URL do ficheiro é obrigatória');
  try {
    const response = await axios({
      method: 'GET', url: fileUrl, responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': new url.URL(fileUrl).origin
      }
    });
    const urlPath = new url.URL(fileUrl).pathname;
    const filename = urlPath.substring(urlPath.lastIndexOf('/') + 1) || 'media.file';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers['content-type']);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Não foi possível baixar o ficheiro.');
  }
});

// 7. Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
});
