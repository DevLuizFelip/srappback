# Usar uma imagem oficial e mais recente do Node.js como base
FROM node:20-slim

# Definir a pasta de trabalho dentro do contentor
WORKDIR /usr/src/app

# Atualizar os pacotes e instalar as dependências do sistema (LISTA COMPLETA E OFICIAL PARA PUPPETEER)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # Nossas outras dependências
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Instalar o yt-dlp usando pip
RUN pip3 install yt-dlp --break-system-packages

# Copiar os ficheiros de configuração do projeto
COPY package*.json ./

# Instalar as dependências do Node.js
RUN npm install

# Copiar o resto do código da aplicação
COPY . .

# Expor a porta em que a aplicação corre
EXPOSE 3001

# Definir o comando para iniciar a aplicação
CMD ["node", "server.js"]