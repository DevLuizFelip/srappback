// server.js (Versão Otimizada para Imagens)

// 1. Importar as bibliotecas necessárias
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const url = require('url');
const sharp = require('sharp'); // <-- NOVO: Biblioteca de otimização de imagens

// 2. Inicializar o aplicativo Express
const app = express();
const PORT = process.env.PORT || 3001;

// 3. Configurar o CORS
app.use(cors());

// --- Função para extrair mídia com yt-dlp ---
async function extractMediaWithYtDlp(pageUrl) {
    const ytDlpCommand = 'yt-dlp';
    const args = ['--ignore-errors', '-j', '--no-warnings', pageUrl];

    return new Promise((resolve) => {
        const ytDlpProcess = spawn(ytDlpCommand, args);
        let stdoutData = '';
        ytDlpProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        ytDlpProcess.stderr.on('data', (data) => {});

        ytDlpProcess.on('close', (code) => {
            if (!stdoutData.trim()) return resolve([]);
            try {
                const mediaItems = [];
                stdoutData.trim().split('\n').forEach(line => {
                    try {
                        const videoInfo = JSON.parse(line);
                        if (videoInfo.url && videoInfo.thumbnail) {
                            mediaItems.push({
                                url: videoInfo.url,
                                thumbnailUrl: videoInfo.thumbnail,
                                author: videoInfo.uploader || new url.URL(pageUrl).hostname,
                                type: 'video'
                            });
                        }
                    } catch (e) {}
                });
                resolve(mediaItems);
            } catch (parseError) {
                console.error('Erro ao fazer parse da saída JSON do yt-dlp:', parseError);
                resolve([]);
            }
        });
        ytDlpProcess.on('error', (err) => { console.error('Falha ao iniciar o processo yt-dlp.', err); resolve([]); });
    });
}

// --- Função de Scraping com Puppeteer (plano B) ---
async function scrapeMediaWithPuppeteer(pageUrl) {
    let browser = null;
    const foundMedia = new Set(); 
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const requestUrl = request.url();
            if (/\.(jpg|jpeg|png|gif|webp)$/i.test(requestUrl)) { // Apenas imagens
                foundMedia.add(requestUrl);
            }
            request.continue();
        });
        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await browser.close();
        return Array.from(foundMedia);
    } catch (error) {
        if (browser) await browser.close();
        return [];
    }
}

// 5. Endpoint da API
app.get('/api/media', async (req, res) => {
  const sources = req.query.sources ? req.query.sources.split(',') : [];
  if (sources.length === 0) return res.json([]);

  let allMedia = [];
  let idCounter = 0;

  for (const source of sources) {
    try {
        const videoDataList = await extractMediaWithYtDlp(source);
        if (videoDataList.length > 0) {
            videoDataList.forEach(videoData => {
                allMedia.push({
                    id: `yt-dlp-${idCounter++}`, type: 'video', url: videoData.url,
                    thumbnailUrl: videoData.thumbnailUrl, author: videoData.author,
                    source: 'web', timestamp: new Date(),
                });
            });
        } else {
            const mediaUrls = await scrapeMediaWithPuppeteer(source);
            for (const mediaUrl of mediaUrls) {
                allMedia.push({
                    id: `scrape-${idCounter++}`, type: 'image', url: mediaUrl,
                    author: new url.URL(source).hostname, source: 'web', timestamp: new Date(),
                });
            }
        }
    } catch (error) {
        console.log(`Fonte "${source}" não é um URL válido para scraping, ignorando.`);
    }
  }
  res.json(allMedia);
});

// --- NOVO: Endpoint de Otimização de Imagens ---
app.get('/api/image-proxy', async (req, res) => {
    const { url: imageUrl, q: quality } = req.query;
    if (!imageUrl) return res.status(400).send('URL da imagem é obrigatória');

    try {
        const response = await axios({ url: imageUrl, responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data, 'binary');

        let transformer = sharp(imageBuffer);

        if (quality === 'low') {
            // Placeholder: muito pequeno, desfocado e baixa qualidade
            transformer = transformer.resize(20).blur(5).webp({ quality: 20 });
        } else {
            // Imagem normal: redimensionada e otimizada
            transformer = transformer.resize(1280, null, { withoutEnlargement: true }).webp({ quality: 80 });
        }

        const optimizedBuffer = await transformer.toBuffer();
        res.set('Content-Type', 'image/webp');
        res.send(optimizedBuffer);

    } catch (error) {
        console.error(`Falha ao processar a imagem ${imageUrl}:`, error.message);
        res.status(500).send('Não foi possível processar a imagem.');
    }
});


// 7. Endpoint para fazer o proxy do download
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
    console.error(`Falha ao baixar o ficheiro de ${fileUrl}:`, error.message);
    res.status(500).send('Não foi possível baixar o ficheiro.');
  }
});

// 8. Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
});
