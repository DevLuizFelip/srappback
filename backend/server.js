// server.js

// 1. Importar as bibliotecas necessárias
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const url = require('url');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// 2. Inicializar o aplicativo Express
const app = express();
const PORT = 3001;

// 3. Configurar o CORS
app.use(cors());

// --- Função para atualizar o yt-dlp automaticamente ---
function updateYtDlp() {
    console.log('[DIAGNÓSTICO] Verificando atualizações para o yt-dlp...');
    const ytDlpPath = 'yt-dlp'; // Usa a versão instalada no sistema
    
    if (!fs.existsSync(ytDlpPath)) {
        console.error(`\n[ERRO CRÍTICO] O ficheiro 'yt-dlp.exe' não foi encontrado em: ${ytDlpPath}`);
        console.error("[AÇÃO NECESSÁRIA] Por favor, baixe o 'yt-dlp.exe' e coloque-o na mesma pasta que o seu ficheiro 'server.js'.\n");
        return;
    }
    
    const updateProcess = spawn(ytDlpPath, ['-U'], { shell: true });
    updateProcess.stdout.on('data', (data) => console.log(`[yt-dlp update]: ${data.toString().trim()}`));
    updateProcess.stderr.on('data', (data) => console.error(`[yt-dlp update stderr]: ${data.toString().trim()}`));
    updateProcess.on('close', (code) => console.log(`[DIAGNÓSTICO] Processo de atualização do yt-dlp concluído com o código ${code}.`));
    updateProcess.on('error', (err) => console.error('[DIAGNÓSTICO] Falha ao iniciar o processo de atualização do yt-dlp.', err));
}

// --- Função para extrair mídia com yt-dlp (COM SELEÇÃO DE FORMATO AUTOMÁTICA) ---
async function extractMediaWithYtDlp(pageUrl) {
    console.log(`[DIAGNÓSTICO] Iniciando extração com yt-dlp para: ${pageUrl}`);
    const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
    const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');
    
    if (!fs.existsSync(ytDlpPath)) {
        console.error(`[ERRO CRÍTICO] 'yt-dlp.exe' não encontrado. A extração de vídeo foi ignorada.`);
        return Promise.resolve([]);
    }

    // --- COMANDO FINAL: Deixa o yt-dlp escolher o melhor formato disponível ---
    const args = [
        // A flag '-f' foi removida para permitir que o yt-dlp escolha o melhor formato automaticamente.
        // Isto aumenta a compatibilidade com todos os sites.
        '--ignore-errors',
        '-j', // Obter saída JSON
        '--no-warnings',
        pageUrl
    ];

    if (fs.existsSync(ffmpegPath)) {
        console.log('[DIAGNÓSTICO] FFmpeg encontrado. Adicionando ao comando.');
        args.push('--ffmpeg-location', __dirname);
    } else {
        console.warn("\n[AVISO] 'ffmpeg.exe' não foi encontrado na pasta do backend.");
        console.warn("[AÇÃO RECOMENDADA] Para baixar vídeos de mais sites, baixe o ffmpeg e coloque os ficheiros .exe na mesma pasta que o server.js.\n");
    }

    return new Promise((resolve) => {
        const ytDlpProcess = spawn(ytDlpPath, args, { shell: true });
        
        let stdoutData = '';
        ytDlpProcess.stdout.on('data', (data) => { stdoutData += data.toString(); });
        ytDlpProcess.stderr.on('data', (data) => { /* Silenciar stderr para evitar poluir o log */ });

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
        const $ = cheerio.load(content);

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
  console.log(`Servidor backend rodando em http://localhost:${PORT}`);
  updateYtDlp();
});
