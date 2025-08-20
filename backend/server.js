// server.js (Versão para Deploy na Render)

// 1. Importar as bibliotecas necessárias
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

// 2. Inicializar o aplicativo Express
const app = express();
const PORT = process.env.PORT || 3001; // Render define a porta automaticamente

// 3. Configurar o CORS
app.use(cors());

// --- Função para extrair mídia com yt-dlp (Versão para Servidor) ---
async function extractMediaWithYtDlp(pageUrl) {
    console.log(`[DIAGNÓSTICO] Iniciando extração com yt-dlp para: ${pageUrl}`);
    const ytDlpCommand = 'yt-dlp'; // Usa o comando instalado no sistema
    
    const args = [
        '--ignore-errors',
        '-j', // Obter saída JSON
        '--no-warnings',
        pageUrl
    ];

    return new Promise((resolve) => {
        const ytDlpProcess = spawn(ytDlpCommand, args);
        
        let stdoutData = '';
        ytDlpProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        ytDlpProcess.stderr.on('data', (data) => { /* Silenciar stderr */ });

        ytDlpProcess.on('close', (code) => {
            if (!stdoutData.trim()) {
                console.warn(`[DIAGNÓSTICO] yt-dlp não produziu nenhuma saída para ${pageUrl}.`);
                return resolve([]);
            }

            try {
                const mediaItems = [];
                const lines = stdoutData.trim().split('\n');
                lines.forEach(line => {
                    try {
                        const videoInfo = JSON.parse(line);
                        if (videoInfo.url && videoInfo.thumbnail) {
                            mediaItems.push({
                                url: videoInfo.url,
                                thumbnailUrl: videoInfo.thumbnail,
                                author: videoInfo.uploader || new URL(pageUrl).hostname,
                                type: 'video'
                            });
                        }
                    } catch (e) { /* Ignora linhas que não são JSON */ }
                });
                console.log(`[DIAGNÓSTICO] Sucesso! yt-dlp encontrou ${mediaItems.length} vídeos em ${pageUrl}`);
                resolve(mediaItems);
            } catch (parseError) {
                console.error('[DIAGNÓSTICO] Erro CRÍTICO ao fazer parse da saída JSON do yt-dlp:', parseError);
                resolve([]);
            }
        });

        ytDlpProcess.on('error', (err) => {
            console.error('[DIAGNÓSTICO] Falha ao iniciar o processo yt-dlp.', err);
            resolve([]);
        });
    });
}


// --- Função de Scraping com Puppeteer (plano B) ---
async function scrapeMediaWithPuppeteer(pageUrl) {
    console.log(`[DIAGNÓSTICO] Iniciando scraping com Puppeteer para: ${pageUrl}`);
    let browser = null;
    const foundMedia = new Set(); 

    try {
        // Adiciona a flag --no-sandbox, essencial para ambientes como o da Render
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const requestUrl = request.url();
            if (/\.(mp4|webm|jpg|jpeg|png|gif|webp)$/i.test(requestUrl)) {
                foundMedia.add(requestUrl);
            }
            request.continue();
        });

        await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        const content = await page.content();
        const $ = require('cheerio').load(content);

        $('img').each((i, el) => { const src = $(el).attr('src'); if (src) foundMedia.add(new URL(src, pageUrl).href); });
        $('video').each((i, el) => { const src = $(el).attr('src') || $(el).find('source').attr('src'); if (src) foundMedia.add(new URL(src, pageUrl).href); });

        await browser.close();
        console.log(`[DIAGNÓSTICO] Scraping com Puppeteer concluído. Encontrados ${foundMedia.size} itens de mídia.`);
        return Array.from(foundMedia);

    } catch (error) {
        console.error(`[DIAGNÓSTICO] Erro durante o scraping com Puppeteer para ${pageUrl}:`, error.message);
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
                    id: `yt-dlp-${idCounter++}`,
                    type: 'video',
                    url: videoData.url,
                    thumbnailUrl: videoData.thumbnailUrl,
                    author: videoData.author,
                    source: 'web',
                    timestamp: new Date(),
                });
            });
        } else {
            console.log(`[DIAGNÓSTICO] yt-dlp não encontrou vídeos. Tentando com Puppeteer como plano B.`);
            const mediaUrls = await scrapeMediaWithPuppeteer(source);
            for (const mediaUrl of mediaUrls) {
                const isVideo = /\.(mp4|webm)$/i.test(mediaUrl);
                allMedia.push({
                    id: `scrape-${idCounter++}`,
                    type: isVideo ? 'video' : 'image',
                    url: mediaUrl,
                    author: new URL(source).hostname,
                    source: 'web',
                    timestamp: new Date(),
                });
            }
        }
    } catch (error) {
        console.log(`[DIAGNÓSTICO] Fonte "${source}" não é um URL válido para scraping, ignorando.`);
    }
  }
  res.json(allMedia);
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
        'Referer': new URL(fileUrl).origin
      }
    });
    const urlPath = new URL(fileUrl).pathname;
    const filename = urlPath.substring(urlPath.lastIndexOf('/') + 1) || 'media.file';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', response.headers['content-type']);
    response.data.pipe(res);
  } catch (error) {
    console.error(`Falha ao baixar o ficheiro de ${fileUrl}:`, error.message);
    res.status(500).send('Não foi possível baixar o ficheiro.');
  }
});

// 7. Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor backend rodando na porta ${PORT}`);
});
